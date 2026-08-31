import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PendingDailyRecordSyncTaskSnapshot } from '@/services/storage/sync/pendingDailyRecordSyncTask';
import { preparePatchedRecordForPersistence } from '@/services/repositories/dailyRecordPatchPreparation';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';

const BED_SCOPED_PATH = /^beds\.([^.]+)(?:\.(clinicalCrib)(?:\.|$)|(?:\.|$))/;
const BED_SLOT_METADATA_FIELDS = new Set(['isBlocked', 'blockedReason']);
const RAYEN_OWNED_FIELDS = new Set<string>(RAYEN_OWNED_CLINICAL_FIELDS);

const readPath = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);

const resolveOwnedPaths = (snapshot: PendingDailyRecordSyncTaskSnapshot): string[] => {
  const paths = Array.from(new Set(snapshot.changedPaths.filter(Boolean)));
  if (paths.length === 0 || paths.includes('*')) {
    throw new ConcurrencyError(
      'La sincronización local pendiente no declara cambios granulares y debe resolverse antes de confirmar esta limpieza.'
    );
  }
  return paths.sort((left, right) => left.split('.').length - right.split('.').length);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSupersededByAppliedPatch = (path: string, appliedPaths: string[]): boolean =>
  appliedPaths.some(appliedPath => path === appliedPath || path.startsWith(`${appliedPath}.`));

const isAffectedByAppliedPatch = (path: string, appliedPaths: string[]): boolean =>
  appliedPaths.some(
    appliedPath =>
      path === appliedPath ||
      path.startsWith(`${appliedPath}.`) ||
      appliedPath.startsWith(`${path}.`)
  );

const hasSamePatientOwnerAtPath = (
  path: string,
  pendingRecord: DailyRecord,
  authoritativeRecord: DailyRecord,
  appliedPaths: string[]
): boolean => {
  const match = BED_SCOPED_PATH.exec(path);
  if (!match) return !path.startsWith('beds');
  const [, bedId, clinicalCrib] = match;
  const segments = path.split('.');
  if (!clinicalCrib && segments[2] && BED_SLOT_METADATA_FIELDS.has(segments[2])) return true;
  const pendingBed = pendingRecord.beds[bedId];
  const authoritativeBed = authoritativeRecord.beds[bedId];
  if (!hasSamePatientEpisodeIdentity(pendingBed, authoritativeBed)) return false;
  if (clinicalCrib) {
    return hasSamePatientEpisodeIdentity(pendingBed?.clinicalCrib, authoritativeBed?.clinicalCrib);
  }
  if (segments.length === 2) {
    const cribPath = `beds.${bedId}.clinicalCrib`;
    return (
      isAffectedByAppliedPatch(cribPath, appliedPaths) ||
      hasSamePatientEpisodeIdentity(pendingBed?.clinicalCrib, authoritativeBed?.clinicalCrib)
    );
  }
  return true;
};

const buildSafePendingPatch = ({
  authoritativeRecord,
  pendingTask,
  alreadyAppliedPatch,
}: {
  authoritativeRecord: DailyRecord;
  pendingTask: PendingDailyRecordSyncTaskSnapshot;
  alreadyAppliedPatch: DailyRecordPatch;
}): DailyRecordPatch => {
  const appliedPaths = Object.keys(alreadyAppliedPatch);
  return resolveOwnedPaths(pendingTask).reduce<DailyRecordPatch>((patch, path) => {
    if (isSupersededByAppliedPatch(path, appliedPaths)) return patch;
    if (!hasSamePatientOwnerAtPath(path, pendingTask.record, authoritativeRecord, appliedPaths)) {
      throw new ConcurrencyError(
        'La cama o la cuna cambió de paciente mientras existía una sincronización local pendiente. Recargue el censo antes de continuar.'
      );
    }
    const pendingValue = readPath(pendingTask.record, path);
    const rootBedMatch = /^beds\.([^.]+)$/.exec(path);
    if (
      rootBedMatch &&
      isObject(pendingValue) &&
      isAffectedByAppliedPatch(`beds.${rootBedMatch[1]}.clinicalCrib`, appliedPaths)
    ) {
      patch[path] = {
        ...pendingValue,
        clinicalCrib: authoritativeRecord.beds[rootBedMatch[1]]?.clinicalCrib,
      };
      return patch;
    }
    patch[path] = pendingValue;
    return patch;
  }, {});
};

const buildAuthoritativeClinicalFieldProtection = (
  authoritativeRecord: DailyRecord,
  pendingPatch: DailyRecordPatch
): DailyRecordPatch => {
  const protectedFields = new Map<string, Set<string>>();
  const protect = (rootPath: string, fields: readonly string[]) => {
    const current = protectedFields.get(rootPath) ?? new Set<string>();
    fields.forEach(field => current.add(field));
    protectedFields.set(rootPath, current);
  };
  Object.keys(pendingPatch).forEach(path => {
    const match = /^beds\.([^.]+)(?:\.(clinicalCrib))?(?:\.(.+))?$/.exec(path);
    if (!match) return;
    const [, bedId, clinicalCrib, fieldPath] = match;
    const rootPath = `beds.${bedId}${clinicalCrib ? '.clinicalCrib' : ''}`;
    const field = fieldPath?.split('.')[0];
    if (!fieldPath) {
      protect(rootPath, RAYEN_OWNED_CLINICAL_FIELDS);
      if (!clinicalCrib) protect(`${rootPath}.clinicalCrib`, RAYEN_OWNED_CLINICAL_FIELDS);
    } else if (field && RAYEN_OWNED_FIELDS.has(field)) {
      protect(rootPath, [field]);
    }
  });
  return Array.from(protectedFields).reduce<DailyRecordPatch>((patch, [rootPath, fields]) => {
    const authoritativePatient = readPath(authoritativeRecord, rootPath);
    if (!isObject(authoritativePatient)) return patch;
    fields.forEach(field => {
      patch[`${rootPath}.${field}`] = Object.prototype.hasOwnProperty.call(
        authoritativePatient,
        field
      )
        ? authoritativePatient[field]
        : undefined;
    });
    return patch;
  }, {});
};

export const rebasePendingDailyRecordWrite = ({
  authoritativeRecord,
  pendingTask,
  alreadyAppliedPatch,
}: {
  authoritativeRecord: DailyRecord;
  pendingTask: PendingDailyRecordSyncTaskSnapshot;
  alreadyAppliedPatch: DailyRecordPatch;
}): { record: DailyRecord; changedPaths: string[]; pendingPaths: string[] } => {
  const pendingPatch = buildSafePendingPatch({
    authoritativeRecord,
    pendingTask,
    alreadyAppliedPatch,
  });
  const pendingPaths = Object.keys(pendingPatch);
  const authoritativeClinicalProtection = buildAuthoritativeClinicalFieldProtection(
    authoritativeRecord,
    pendingPatch
  );
  const { record, mergedPatches } = preparePatchedRecordForPersistence(
    authoritativeRecord,
    authoritativeRecord.date,
    { ...pendingPatch, ...alreadyAppliedPatch, ...authoritativeClinicalProtection }
  );
  // El replacement sólo declara lo genuinamente pendiente. Los paths del comando
  // ya aplicado son durables en el registro autoritativo: volver a declararlos
  // mantenía viva la propiedad del subárbol cama–cuna y hacía que la adopción del
  // siguiente comando (p. ej. recrear la cuna) fallara contra la guardia de
  // identidad. La protección clínica autoritativa tampoco es un cambio: fija los
  // valores que el registro base ya tiene.
  const replacementChangedPaths = Object.keys(mergedPatches).filter(path =>
    isAffectedByAppliedPatch(path, pendingPaths)
  );
  return {
    record,
    changedPaths: replacementChangedPaths.length > 0 ? replacementChangedPaths : pendingPaths,
    pendingPaths,
  };
};
