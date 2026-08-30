import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { flattenObject } from '@/services/storage/firestore/firestoreShared';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';
import { applyPatches } from '@/utils/patchUtils';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';

const RAYEN_OWNED_FIELDS = new Set<string>(RAYEN_OWNED_CLINICAL_FIELDS);

const isProjectionOnlyPath = (path: string): boolean => {
  const segments = path.split('.');
  return (
    path === 'lastUpdated' ||
    path === 'dateTimestamp' ||
    path === 'meta' ||
    path.startsWith('meta.') ||
    segments.includes('fhir_resource') ||
    segments.some(segment => RAYEN_OWNED_FIELDS.has(segment))
  );
};

const hasSameSerializableValue = (left: unknown, right: unknown): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

const BED_SCOPED_PATH = /^beds\.([^.]+)(?:\.(clinicalCrib)(?:\.|$)|(?:\.|$))/;

const canProjectPathOntoRecord = (
  path: string,
  confirmedRecord: DailyRecord,
  newerRecord: DailyRecord
): boolean => {
  const match = BED_SCOPED_PATH.exec(path);
  if (!match) return !path.startsWith('beds');
  const [, bedId, clinicalCrib] = match;
  const confirmedBed = confirmedRecord.beds[bedId];
  const newerBed = newerRecord.beds[bedId];
  if (!hasSamePatientEpisodeIdentity(confirmedBed, newerBed)) return false;
  return clinicalCrib
    ? hasSamePatientEpisodeIdentity(confirmedBed?.clinicalCrib, newerBed?.clinicalCrib)
    : true;
};

export const rebaseLocalProjectionOntoNewerRecord = (
  confirmedRecord: DailyRecord,
  localProjectionRecord: DailyRecord,
  newerRecord: DailyRecord
): DailyRecord => {
  const confirmed = flattenObject(confirmedRecord as unknown as Record<string, unknown>);
  const projection = flattenObject(localProjectionRecord as unknown as Record<string, unknown>);
  const paths = new Set([...Object.keys(confirmed), ...Object.keys(projection)]);
  const projectionPatch = Array.from(paths).reduce<DailyRecordPatch>((patch, path) => {
    if (
      !isProjectionOnlyPath(path) &&
      canProjectPathOntoRecord(path, confirmedRecord, newerRecord) &&
      !hasSameSerializableValue(confirmed[path], projection[path])
    ) {
      patch[path] = projection[path];
    }
    return patch;
  }, {});
  return applyPatches(newerRecord, projectionPatch);
};

export const shouldRollbackOptimisticDailyRecord = (
  cachedRecord: DailyRecord | null | undefined,
  optimisticRecord: DailyRecord | null | undefined
): boolean =>
  !cachedRecord ||
  cachedRecord === optimisticRecord ||
  cachedRecord.lastUpdated === optimisticRecord?.lastUpdated;

export const shouldPublishAuthoritativeConflictRecord = (
  cachedRecord: DailyRecord | null | undefined,
  optimisticRecord: DailyRecord | null | undefined,
  authoritativeRecord: DailyRecord
): boolean =>
  !cachedRecord ||
  cachedRecord === optimisticRecord ||
  cachedRecord.lastUpdated === optimisticRecord?.lastUpdated ||
  toRecordTimestamp(cachedRecord.lastUpdated) <= toRecordTimestamp(authoritativeRecord.lastUpdated);
