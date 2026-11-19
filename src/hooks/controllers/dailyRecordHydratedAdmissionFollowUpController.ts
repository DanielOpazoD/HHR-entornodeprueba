import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  normalizeDailyRecordClinicalField,
  parseDailyRecordBedPatchPath,
} from '@/hooks/controllers/dailyRecordClinicalPatchPathController';
import {
  getPathValue,
  hasMeaningfulText,
  patchValueMatchesHydratedRecord,
} from '@/hooks/controllers/dailyRecordHydratedPatchValues';

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

const hasHydratedDiagnosisValue = (hydratedRecord: DailyRecord, bedId: string): boolean => {
  const hydratedBed = hydratedRecord.beds?.[bedId];
  if (!hydratedBed) {
    return false;
  }

  return Array.from(DIAGNOSIS_FOLLOW_UP_FIELDS).some(field =>
    hasMeaningfulText(getPathValue(hydratedBed, field))
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
