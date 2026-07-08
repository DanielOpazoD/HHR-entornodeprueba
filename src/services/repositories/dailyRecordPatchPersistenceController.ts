import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';
import { applyPatches } from '@/utils/patchUtils';
import { logError } from '@/services/utils/errorService';
import {
  addClinicalFhirPatchesForTouchedBeds,
  ensureDailyRecordDateTimestamp,
  isSpecialistScopedDailyRecordPatch,
  touchDailyRecordLastUpdated,
} from '@/services/repositories/dailyRecordDomainServices';
import { assertAdmissionDatePersistencePolicy } from '@/services/repositories/dailyRecordAdmissionDateWritePolicy';
import { buildInvariantRepairReviewContext } from '@/services/repositories/invariantRepairReviewContext';
import { buildDailyRecordClinicalEpisodeIdPatches } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

export const preparePatchedRecordPersistence = (
  current: DailyRecord,
  date: string,
  patch: DailyRecordPatch
): { record: DailyRecord; mergedPatches: DailyRecordPatch } => {
  const updatedForInvariants = applyPatches(current, patch);
  assertAdmissionDatePersistencePolicy(date, updatedForInvariants, current, {
    changedPaths: Object.keys(patch),
  });
  const mergedPatches: DailyRecordPatch = { ...patch };
  ensureDailyRecordDateTimestamp(updatedForInvariants);

  if (updatedForInvariants.dateTimestamp != null) {
    mergedPatches.dateTimestamp = updatedForInvariants.dateTimestamp;
  }

  const shouldSkipStructuralNormalization = isSpecialistScopedDailyRecordPatch(mergedPatches);
  if (!shouldSkipStructuralNormalization) {
    Object.assign(mergedPatches, buildDailyRecordClinicalEpisodeIdPatches(updatedForInvariants));
  }

  const normalized = normalizeDailyRecordInvariants(applyPatches(current, mergedPatches));
  const movementConsistency = normalizeMovementBedConsistency(normalized.record);

  if (!shouldSkipStructuralNormalization) {
    Object.assign(mergedPatches, normalized.patches);
    Object.assign(mergedPatches, movementConsistency.patches);
  }

  const repairPaths = [
    ...Object.keys(normalized.patches),
    ...Object.keys(movementConsistency.patches),
  ];

  if (!shouldSkipStructuralNormalization && repairPaths.length > 0) {
    logError(
      'Invariant repair applied on updatePartial',
      undefined,
      buildInvariantRepairReviewContext({
        date,
        operation: 'updatePartial',
        repairPaths,
        touchedPaths: Object.keys(patch),
      })
    );
  }

  const updated = applyPatches(current, mergedPatches);
  touchDailyRecordLastUpdated(updated);

  const validatedRecord = validateAndSalvageRecord(updated, date);
  addClinicalFhirPatchesForTouchedBeds(mergedPatches, validatedRecord);

  return {
    record: validatedRecord,
    mergedPatches,
  };
};
