import { clinicalValuesEqual } from './clinicalIncrementalSync';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '../contracts/clinicalFillContracts';
import {
  clinicalFieldValuesEqual,
  type CanonicalClinicalField,
} from './clinicalFieldCanonicalization';
import {
  assertDocumentaryCudyrTarget,
  CUDYR_DOCUMENTARY_SOURCE,
  hasAcceptedCudyr,
} from '@/domain/evaluationScales/documentaryCudyr';

const CLINICAL_FIELDS = new Set<CanonicalClinicalField>([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
  'clinicalCarryover',
  'clinicalAlerts',
  'fluidBalance',
]);

interface LocatedClinicalPatient {
  bedId: string;
  clinicalCrib: boolean;
  patient: PatientData;
}

const findClinicalPatient = (
  record: DailyRecord,
  clinicalEpisodeId: string,
  clinicalCrib: boolean
): LocatedClinicalPatient | undefined => {
  for (const [bedId, patient] of Object.entries(record.beds)) {
    const candidate = clinicalCrib ? patient.clinicalCrib : patient;
    if (candidate?.clinicalEpisodeId === clinicalEpisodeId) {
      return { bedId, clinicalCrib, patient: candidate };
    }
  }
  return undefined;
};

const fieldFromPatchPath = (path: string): CanonicalClinicalField | undefined => {
  const field = path.split('.').at(-1) as CanonicalClinicalField | undefined;
  return field && CLINICAL_FIELDS.has(field) ? field : undefined;
};

const fieldValue = (patient: PatientData, field: CanonicalClinicalField) => patient[field];

// The run's base can come from the local copy, which drops null leaves, while the write turn reads
// the server copy, which keeps them. A leaf that is null on one side and absent on the other is the
// same stored value, not a concurrent edit.
const withoutNullLeaves = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutNullLeaves);
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, withoutNullLeaves(item)])
  );
};

const sameStoredValue = (
  field: CanonicalClinicalField,
  left: PatientData[CanonicalClinicalField],
  right: PatientData[CanonicalClinicalField]
): boolean =>
  clinicalFieldValuesEqual(
    field,
    withoutNullLeaves(left) as PatientData[CanonicalClinicalField],
    withoutNullLeaves(right) as PatientData[CanonicalClinicalField]
  );

const operationLogicalTargetKey = (operation: ClinicalFillPatchOperation): string =>
  `${operation.target.clinicalEpisodeId}|${operation.target.clinicalCrib ? 'crib' : 'patient'}`;

/** Mirrors the batch builder: one canonical operation per episode and patient/crib target. */
const coalesceOperationsByLogicalTarget = (
  operations: ClinicalFillPatchOperation[]
): ClinicalFillPatchOperation[] => {
  const byTarget = new Map<string, ClinicalFillPatchOperation>();
  operations.forEach(operation => {
    const key = operationLogicalTargetKey(operation);
    const previous = byTarget.get(key);
    if (!previous) {
      byTarget.set(key, operation);
      return;
    }
    if (previous.target.bedId !== operation.target.bedId) {
      throw new Error('El lote clínico contiene un episodio ambiguo antes de reconstruirse.');
    }
    byTarget.set(key, {
      target: previous.target,
      patch: { ...previous.patch, ...operation.patch },
      clinicalFieldCount: (previous.clinicalFieldCount ?? 0) + (operation.clinicalFieldCount ?? 0),
      checkpointChanged: previous.checkpointChanged || operation.checkpointChanged,
    });
  });
  return [...byTarget.values()];
};

/**
 * Revalidates deferred Rayen operations against a freshly read census.
 *
 * A desired value is retained only when its field still equals the run's original base. Values
 * already committed disappear from the rebuilt delta; a third concurrent value fails closed so a
 * stale clinical object can never be stamped onto a newer revision.
 *
 * With `onFieldConflict`, such a target is left out and reported instead, so the other patients
 * of the batch are still written. When every target conflicts, the rebuild still throws.
 */
export const rebuildClinicalEnrichmentOperations = ({
  baseRecord,
  currentRecord,
  operations,
  onFieldConflict,
}: {
  baseRecord: DailyRecord;
  currentRecord: DailyRecord;
  operations: ClinicalFillPatchOperation[];
  onFieldConflict?: (operation: ClinicalFillPatchOperation, error: Error) => void;
}): ClinicalFillPatchOperation[] => {
  const targets = coalesceOperationsByLogicalTarget(operations);
  const conflicts: { operation: ClinicalFillPatchOperation; error: Error }[] = [];
  const rebuilt = targets.flatMap((operation): ClinicalFillPatchOperation[] => {
    const isCrib = operation.target.clinicalCrib === true;
    const episodeId = operation.target.clinicalEpisodeId;
    const base = findClinicalPatient(baseRecord, episodeId, isCrib);
    const current = findClinicalPatient(currentRecord, episodeId, isCrib);
    if (!base || !current) {
      throw new Error('El episodio clínico cambió durante la persistencia del lote.');
    }

    const prefix = `beds.${current.bedId}${current.clinicalCrib ? '.clinicalCrib' : ''}`;
    const patch: ClinicalFillPatchOperation['patch'] = {};
    for (const [path, desired] of Object.entries(operation.patch)) {
      const field = fieldFromPatchPath(path);
      if (!field) {
        throw new Error('El lote clínico contiene un campo que no puede reconstruirse.');
      }
      const desiredValue = desired as PatientData[CanonicalClinicalField];
      if (field === 'evaluationScores') {
        const cudyr = (desired as PatientData['evaluationScores'])?.cudyr;
        if (
          cudyr &&
          (cudyr.source === CUDYR_DOCUMENTARY_SOURCE || cudyr.documentaryEvidence) &&
          !clinicalValuesEqual(current.patient.evaluationScores?.cudyr, cudyr)
        ) {
          assertDocumentaryCudyrTarget(currentRecord, current.patient, cudyr);
          if (
            hasAcceptedCudyr(current.patient) &&
            !clinicalFieldValuesEqual(
              'evaluationScores',
              current.patient.evaluationScores,
              desiredValue
            )
          )
            throw new Error('El CUDYR ya fue registrado durante la recuperación mensual.');
        }
      }
      const baseValue = fieldValue(base.patient, field);
      const currentValue = fieldValue(current.patient, field);
      if (clinicalFieldValuesEqual(field, currentValue, desiredValue)) continue;
      if (!sameStoredValue(field, currentValue, baseValue)) {
        const error = new Error('Un campo clínico cambió mientras se preparaba el lote.');
        if (!onFieldConflict) throw error;
        conflicts.push({ operation, error });
        return [];
      }
      patch[`${prefix}.${field}`] = desiredValue as never;
    }

    const checkpointPath = `${prefix}.clinicalSyncCheckpoint`;
    const checkpointChanged = Object.prototype.hasOwnProperty.call(patch, checkpointPath);
    const clinicalFieldCount = Object.keys(patch).filter(path => path !== checkpointPath).length;
    if (clinicalFieldCount === 0 && !checkpointChanged) return [];
    return [
      {
        ...operation,
        patch,
        clinicalFieldCount,
        checkpointChanged,
        target: {
          ...operation.target,
          bedId: current.bedId,
          ...(current.clinicalCrib ? { clinicalCrib: true as const } : {}),
        },
      },
    ];
  });
  if (conflicts.length > 0 && conflicts.length === targets.length) throw conflicts[0]!.error;
  conflicts.forEach(({ operation, error }) => onFieldConflict?.(operation, error));
  return rebuilt;
};
