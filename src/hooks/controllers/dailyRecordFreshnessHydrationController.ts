import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';

export const didDailyRecordFreshnessHydrateNewerRemote = (
  result: DailyRecordQueryResult
): boolean => {
  const conflictSummary = result.runtime.conflictSummary;
  if (conflictSummary?.kind !== 'hydrated_from_remote') {
    return false;
  }

  return (
    toRecordTimestamp(conflictSummary.remoteTimestamp) >
    toRecordTimestamp(conflictSummary.localTimestamp)
  );
};
