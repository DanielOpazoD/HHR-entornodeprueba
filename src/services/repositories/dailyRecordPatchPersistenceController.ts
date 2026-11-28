import type { DailyRecord } from '@/types/domain/dailyRecord';
import Dexie from 'dexie';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { normalizeDailyRecordInvariants } from '@/utils/recordInvariants';
import {
  listMovementRepairsWorthReviewing,
  normalizeMovementBedConsistency,
} from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';
import { applyPatches } from '@/utils/patchUtils';
import { logError } from '@/services/utils/errorService';
import {
  addClinicalFhirPatchesForTouchedBeds,
  isClinicalEventsOnlyDailyRecordPatch,
} from '@/services/repositories/dailyRecordClinicalDomainService';
import {
  ensureDailyRecordDateTimestamp,
  touchDailyRecordLastUpdated,
} from '@/services/repositories/dailyRecordMetadataDomainService';
import { assertAdmissionDatePersistencePolicy } from '@/services/repositories/dailyRecordAdmissionDateWritePolicy';
import { buildInvariantRepairReviewContext } from '@/services/repositories/invariantRepairReviewContext';
import { buildDailyRecordClinicalEpisodeIdPatches } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import { mergeRayenSyncHistory } from '@/services/repositories/dailyRecordRayenSyncHistoryPolicy';

export const preparePatchedRecordPersistence = (
  current: DailyRecord,
  date: string,
  patch: DailyRecordPatch
): { record: DailyRecord; mergedPatches: DailyRecordPatch } => {
  const inputPatch: DailyRecordPatch =
    patch.rayenSyncHistory === undefined
      ? patch
      : {
          ...patch,
          rayenSyncHistory: mergeRayenSyncHistory(current.rayenSyncHistory, patch.rayenSyncHistory),
        };
  let updated = applyPatches(current, inputPatch);
  assertAdmissionDatePersistencePolicy(date, updated, current, {
    changedPaths: Object.keys(inputPatch),
  });
  const mergedPatches: DailyRecordPatch = { ...inputPatch };
  ensureDailyRecordDateTimestamp(updated);

  if (updated.dateTimestamp != null) {
    mergedPatches.dateTimestamp = updated.dateTimestamp;
  }

  if (!isClinicalEventsOnlyDailyRecordPatch(mergedPatches)) {
    Object.assign(mergedPatches, buildDailyRecordClinicalEpisodeIdPatches(updated));
    const normalized = normalizeDailyRecordInvariants(applyPatches(current, mergedPatches));
    const movementConsistency = normalizeMovementBedConsistency(normalized.record);
    Object.assign(mergedPatches, normalized.patches, movementConsistency.patches);

    const repairPaths = [
      ...Object.keys(normalized.patches),
      ...listMovementRepairsWorthReviewing(movementConsistency.patches, current),
    ];
    if (repairPaths.length > 0) {
      // Diagnostics use errorLogs, outside the outbox's dailyRecords/syncQueue transaction.
      Dexie.ignoreTransaction(() =>
        logError(
          'Invariant repair applied on updatePartial',
          undefined,
          buildInvariantRepairReviewContext({
            date,
            operation: 'updatePartial',
            repairPaths,
            touchedPaths: Object.keys(inputPatch),
          })
        )
      );
    }
    updated = applyPatches(current, mergedPatches);
  }

  touchDailyRecordLastUpdated(updated);

  const validatedRecord = validateAndSalvageRecord(updated, date);
  addClinicalFhirPatchesForTouchedBeds(mergedPatches, validatedRecord);

  return {
    record: validatedRecord,
    mergedPatches,
  };
};
