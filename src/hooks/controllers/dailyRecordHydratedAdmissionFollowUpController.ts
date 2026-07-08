import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import {
  normalizeDailyRecordClinicalField,
  parseDailyRecordBedPatchPath,
} from '@/hooks/controllers/dailyRecordClinicalPatchPathController';

const POST_ADMISSION_FOLLOW_UP_FIELDS = new Set([
  'pathology',
  'cie10Code',
  'cie10Description',
  'diagnosisComments',
  'status',
  'specialty',
  'secondarySpecialty',
]);
const DIAGNOSIS_FOLLOW_UP_FIELDS = new Set([
  'pathology',
  'cie10Code',
  'cie10Description',
  'diagnosisComments',
]);

const getPathValue = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);

const valuesDiffer = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

const hasOwnPatchPath = (patch: DailyRecordPatch, path: string): boolean =>
  Object.prototype.hasOwnProperty.call(patch, path);

const getPatchValue = (patch: DailyRecordPatch, path: string): unknown =>
  (patch as Record<string, unknown>)[path];

const normalizeComparableText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const hasMeaningfulText = (value: unknown): boolean => normalizeComparableText(value).length > 0;

const patchValueMatchesHydratedRecord = (
  attemptedPatch: DailyRecordPatch,
  attemptedPath: string,
  hydratedRecord: DailyRecord,
  canonicalPath: string
): boolean => {
  if (!hasOwnPatchPath(attemptedPatch, attemptedPath)) {
    return false;
  }
  return !valuesDiffer(
    getPatchValue(attemptedPatch, attemptedPath),
    getPathValue(hydratedRecord, canonicalPath)
  );
};

const hasHydratedDiagnosisValue = (hydratedRecord: DailyRecord, bedId: string): boolean => {
  const hydratedBed = hydratedRecord.beds?.[bedId] as unknown as
    | Record<string, unknown>
    | undefined;
  if (!hydratedBed) {
    return false;
  }

  return Array.from(DIAGNOSIS_FOLLOW_UP_FIELDS).some(field =>
    hasMeaningfulText(hydratedBed[field])
  );
};

export const isHydratedAdmissionFollowUpClinicalPatch = (
  attemptedPatch: DailyRecordPatch,
  previousRecord: DailyRecord,
  hydratedRecord: DailyRecord,
  bedId: string
): boolean => {
  const previousBed = previousRecord.beds?.[bedId];
  const hydratedBed = hydratedRecord.beds?.[bedId];
  if (!previousBed || !hydratedBed) return false;

  if (hasMeaningfulText(previousBed.patientName) || hasMeaningfulText(previousBed.rut)) {
    return false;
  }

  if (!hasMeaningfulText(hydratedBed.patientName) && !hasMeaningfulText(hydratedBed.rut)) {
    return false;
  }

  return Object.keys(attemptedPatch).every(path => {
    const attemptedBedPatch = parseDailyRecordBedPatchPath(path);
    if (!attemptedBedPatch || attemptedBedPatch.bedId !== bedId || !attemptedBedPatch.field) {
      return false;
    }

    const normalizedField = normalizeDailyRecordClinicalField(attemptedBedPatch.field);
    if (!POST_ADMISSION_FOLLOW_UP_FIELDS.has(normalizedField)) {
      return false;
    }

    if (!attemptedBedPatch.canonicalPath) {
      return true;
    }

    if (
      DIAGNOSIS_FOLLOW_UP_FIELDS.has(normalizedField) &&
      hasHydratedDiagnosisValue(hydratedRecord, bedId)
    ) {
      return patchValueMatchesHydratedRecord(
        attemptedPatch,
        path,
        hydratedRecord,
        attemptedBedPatch.canonicalPath
      );
    }

    return (
      !hasMeaningfulText(getPathValue(hydratedRecord, attemptedBedPatch.canonicalPath)) ||
      patchValueMatchesHydratedRecord(
        attemptedPatch,
        path,
        hydratedRecord,
        attemptedBedPatch.canonicalPath
      )
    );
  });
};
