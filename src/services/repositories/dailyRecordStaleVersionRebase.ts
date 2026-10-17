import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import {
  buildGuardedDailyRecordRemoteWriteOptions,
  canRebaseManualSpecialtyIntent,
  type GuardedDailyRecordPatchPolicy,
} from '@/services/repositories/dailyRecordGuardedCommandPolicy';
import {
  getValueAtPath,
  hasSameValuesAtPaths,
} from '@/services/repositories/conflictResolutionUtils';
import { isValidRemoteAuthorityRecord } from '@/services/repositories/dailyRecordRemotePersistenceState';
import { isSameEpisodeForExplicitCensusPatch } from '@/services/repositories/explicitLocalCensusPatchPolicy';
import { composeNameParts, normalizeComparableName } from '@/schemas/zod/helpers';
import { mapPatientToFhir } from '@/services/utils/fhirMappers';
import { applyPatches } from '@/utils/patchUtils';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';

const DEMOGRAPHIC_NAME_PART_FIELDS = ['firstName', 'lastName', 'secondLastName'] as const;

interface DemographicNameRebase {
  bedId: string;
  patientNamePath: string;
  changedPartPaths: string[];
}

const collectDemographicNameRebases = (changedPaths: string[]): DemographicNameRebase[] => {
  const byBed = new Map<string, { patientNameChanged: boolean; changedPartPaths: string[] }>();

  changedPaths.forEach(path => {
    const [root, bedId, field, ...rest] = path.split('.');
    if (root !== 'beds' || !bedId || !field || rest.length > 0) return;
    if (
      field !== 'patientName' &&
      !(DEMOGRAPHIC_NAME_PART_FIELDS as readonly string[]).includes(field)
    ) {
      return;
    }

    const entry = byBed.get(bedId) ?? { patientNameChanged: false, changedPartPaths: [] };
    if (field === 'patientName') {
      entry.patientNameChanged = true;
    } else {
      entry.changedPartPaths.push(path);
    }
    byBed.set(bedId, entry);
  });

  return Array.from(byBed.entries())
    .filter(([, entry]) => entry.patientNameChanged && entry.changedPartPaths.length > 0)
    .map(([bedId, entry]) => ({
      bedId,
      patientNamePath: `beds.${bedId}.patientName`,
      changedPartPaths: entry.changedPartPaths,
    }));
};

const buildDemographicNameRebasedPatch = (
  patch: DailyRecordPatch,
  freshRemoteRecord: DailyRecord,
  nameRebases: DemographicNameRebase[]
): DailyRecordPatch => {
  const rebasedPatch = { ...patch } as Record<string, unknown>;

  nameRebases.forEach(({ bedId }) => {
    const remotePatient = freshRemoteRecord.beds[bedId];
    if (!remotePatient) return;

    const valueFor = (field: (typeof DEMOGRAPHIC_NAME_PART_FIELDS)[number]): string => {
      const path = `beds.${bedId}.${field}`;
      return String(
        Object.prototype.hasOwnProperty.call(rebasedPatch, path)
          ? rebasedPatch[path]
          : remotePatient[field] || ''
      );
    };
    const patientName = composeNameParts(
      valueFor('firstName'),
      valueFor('lastName'),
      valueFor('secondLastName')
    );
    rebasedPatch[`beds.${bedId}.patientName`] = patientName;

    const fhirPath = `beds.${bedId}.fhir_resource`;
    if (Object.prototype.hasOwnProperty.call(rebasedPatch, fhirPath)) {
      const rebasedPatient = applyPatches(freshRemoteRecord, rebasedPatch as DailyRecordPatch).beds[
        bedId
      ];
      rebasedPatch[fhirPath] = mapPatientToFhir(rebasedPatient);
    }
  });

  return rebasedPatch as DailyRecordPatch;
};

const hasConsistentDerivedPatientName = (
  patient: DailyRecord['beds'][string] | undefined
): boolean => {
  if (!patient) return false;
  const composedName = composeNameParts(
    patient.firstName,
    patient.lastName,
    patient.secondLastName
  );
  return Boolean(
    composedName &&
    normalizeComparableName(composedName) === normalizeComparableName(patient.patientName)
  );
};

export interface StaleVersionRebaseRetryHooks<TResult> {
  retryRemoteWriteOnStaleVersion?: (freshRemoteRecord: DailyRecord) => Promise<TResult | void>;
  canRebaseStaleVersionConflict?: (freshRemoteRecord: DailyRecord, writeError: unknown) => boolean;
}

/**
 * Un patch granular corriente (sin CAS atómico ni guardas Rayen) puede perder
 * el CAS del servidor sólo porque otra escritura propia avanzó la versión
 * entre medio (ráfagas de edición). Si los campos de ESTE patch no cambiaron
 * remotamente respecto de la base local, re-basar la versión y reintentar una
 * vez es seguro y evita degradar a auto-merge + re-encolar el registro entero.
 */
export const buildGranularPatchStaleVersionRetryHooks = <TResult>({
  date,
  options,
  policy,
  isReclassification,
  semanticChangedPaths,
  baseRecord,
  syncContract,
}: {
  date: string;
  options: PartialUpdateDailyRecordOptions;
  policy: GuardedDailyRecordPatchPolicy;
  isReclassification: boolean;
  semanticChangedPaths: string[];
  baseRecord: DailyRecord;
  syncContract: SyncTaskContract;
}): StaleVersionRebaseRetryHooks<TResult> => {
  const manualSpecialty = options.specialtyIntent?.kind === 'manual';
  const eligible =
    !isReclassification &&
    !options.rayenClinicalWriteGuard &&
    (manualSpecialty ||
      (!options.requireAtomicCas && !policy.requireAtomicCas && !policy.remoteAuthorityFirst)) &&
    semanticChangedPaths.length > 0 &&
    !semanticChangedPaths.includes('*');
  if (!eligible) {
    return {};
  }

  const demographicNameRebases = collectDemographicNameRebases(semanticChangedPaths);
  const derivedPatientNamePaths = new Set(
    demographicNameRebases.map(rebase => rebase.patientNamePath)
  );
  // `semanticChangedPaths` comes from the user's command patch, before persistence adds the
  // derived FHIR resource. Only `patientName` therefore needs exclusion here; the retry rebuilds
  // the FHIR path already present in `policy.remoteAuthorityPatch` below.
  const compatibilityPaths = semanticChangedPaths.filter(
    path => !derivedPatientNamePaths.has(path)
  );
  const baseValuesAtPatchPaths = Object.fromEntries(
    compatibilityPaths.map(path => [path, getValueAtPath(baseRecord, path)])
  );

  return {
    retryRemoteWriteOnStaleVersion: freshRemoteRecord => {
      const retryPatch = buildDemographicNameRebasedPatch(
        policy.remoteAuthorityPatch,
        freshRemoteRecord,
        demographicNameRebases
      );
      return updateRecordPartialToFirestore(
        date,
        retryPatch,
        freshRemoteRecord.lastUpdated,
        buildGuardedDailyRecordRemoteWriteOptions({
          options,
          policy: { ...policy, remoteAuthorityPatch: retryPatch },
          syncContract: buildDailyRecordSyncContract(freshRemoteRecord, {
            ...syncContract,
            expectedVersion: freshRemoteRecord.lastUpdated,
            baseRevision: undefined,
            changedPaths: semanticChangedPaths,
          }),
          isReclassification,
        })
      ) as Promise<TResult | void>;
    },
    canRebaseStaleVersionConflict: (freshRemoteRecord, writeError) =>
      (!manualSpecialty ||
        Boolean(
          writeError instanceof ConcurrencyError &&
          writeError.reason === 'version_mismatch' &&
          options.specialtyIntent &&
          canRebaseManualSpecialtyIntent(options.specialtyIntent, baseRecord, freshRemoteRecord)
        )) &&
      hasSameValuesAtPaths(freshRemoteRecord, baseValuesAtPatchPaths) &&
      demographicNameRebases.every(
        ({ bedId }) =>
          hasConsistentDerivedPatientName(freshRemoteRecord.beds[bedId]) &&
          isSameEpisodeForExplicitCensusPatch(freshRemoteRecord.beds[bedId], baseRecord.beds[bedId])
      ),
  };
};

/**
 * Ejecuta el reintento re-basado si aplica. Devuelve `null` cuando el error no
 * es un conflicto de versión rescatable (el caller debe relanzarlo); si el
 * reintento corre, sus propios errores se propagan hacia la recuperación
 * normal del caller.
 */
export const attemptStaleVersionRebaseRetry = async <TResult>({
  writeError,
  date,
  hooks,
  readRemoteConfirmedRecord,
}: {
  writeError: unknown;
  date: string;
  hooks: StaleVersionRebaseRetryHooks<TResult>;
  readRemoteConfirmedRecord?: () => Promise<DailyRecord | null>;
}): Promise<{ result: TResult | void } | null> => {
  if (
    !hooks.retryRemoteWriteOnStaleVersion ||
    !hooks.canRebaseStaleVersionConflict ||
    !readRemoteConfirmedRecord ||
    !(writeError instanceof Error) ||
    writeError.name !== 'ConcurrencyError'
  ) {
    return null;
  }

  const freshRemoteRecord = await readRemoteConfirmedRecord();
  if (
    !isValidRemoteAuthorityRecord(freshRemoteRecord, date) ||
    !hooks.canRebaseStaleVersionConflict(freshRemoteRecord, writeError)
  ) {
    return null;
  }

  return { result: await hooks.retryRemoteWriteOnStaleVersion(freshRemoteRecord) };
};
