import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { fetchRecordsRangeSorted, syncRecordsRange } from '@/services/records/recordQueryService';
import {
  buildVerifiedReclassificationsStamp,
  filterReclassificationsForRange,
  getCalendarDaysInRange,
  mergeRecordsByDateDesc,
  REMOTE_RANGE_SYNC_INTERVAL_MS,
  type RemoteStatsSnapshot,
} from '@/features/analytics/controllers/minsalStatsVerificationController';
import type {
  MinsalCalculationOptions,
  MinsalStatistics,
  SpecialtyReclassification,
} from '@/features/analytics/types/minsalTypes';
import type { DailyRecordMovementState as DailyRecord } from '@/types/domain/dailyRecordSlices';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export const loadMinsalRangeRecords = async (params: {
  previousPeriodStart: string;
  endDate: string;
  lastRemoteRangeSyncByKey: Map<string, number>;
}): Promise<DailyRecord[]> => {
  const { previousPeriodStart, endDate, lastRemoteRangeSyncByKey } = params;
  const localRecords = await fetchRecordsRangeSorted(previousPeriodStart, endDate);
  const expectedDays = getCalendarDaysInRange(previousPeriodStart, endDate);

  if (localRecords.length >= expectedDays) {
    return localRecords;
  }

  const rangeKey = `${previousPeriodStart}:${endDate}`;
  const lastSyncAt = lastRemoteRangeSyncByKey.get(rangeKey);
  if (lastSyncAt !== undefined && Date.now() - lastSyncAt < REMOTE_RANGE_SYNC_INTERVAL_MS) {
    return localRecords;
  }
  lastRemoteRangeSyncByKey.set(rangeKey, Date.now());
  try {
    const syncedRecords = await syncRecordsRange(previousPeriodStart, endDate);
    if (syncedRecords.length === 0) {
      return localRecords;
    }

    return mergeRecordsByDateDesc(localRecords, syncedRecords);
  } catch (error) {
    // A failed attempt must not make a retry accept the local range as a completed sync.
    lastRemoteRangeSyncByKey.delete(rangeKey);
    throw error;
  }
};

export const fetchRemoteMinsalStatsSnapshot = async (params: {
  queryClient: QueryClient;
  reclassificationsQueryKey: QueryKey;
  saveReclassificationMutationKey: QueryKey;
  hospitalId: string;
  startDate: string;
  endDate: string;
  safeRemoteOptions: Pick<MinsalCalculationOptions, 'specialtyGroupingMode'>;
}): Promise<RemoteStatsSnapshot> => {
  const {
    queryClient,
    reclassificationsQueryKey,
    saveReclassificationMutationKey,
    hospitalId,
    startDate,
    endDate,
    safeRemoteOptions,
  } = params;
  const reclassState =
    queryClient.getQueryState<SpecialtyReclassification[]>(reclassificationsQueryKey);
  const isPendingSave =
    queryClient.isMutating({ mutationKey: saveReclassificationMutationKey }) > 0;
  const reclassificationsStamp =
    !isPendingSave &&
    reclassState &&
    reclassState.status === 'success' &&
    !reclassState.error &&
    !reclassState.isInvalidated &&
    reclassState.dataUpdateCount > 0
      ? buildVerifiedReclassificationsStamp(
          reclassState.dataUpdateCount,
          reclassState.dataUpdatedAt,
          filterReclassificationsForRange(reclassState.data ?? [], startDate, endDate)
        )
      : null;
  const functions = await defaultFunctionsRuntime.getFunctions();
  const { httpsCallable } = await import('firebase/functions');
  const calculateStats = httpsCallable(functions, 'calculateMinsalStats');
  const result = await calculateStats({
    hospitalId,
    startDate,
    endDate,
    options: safeRemoteOptions,
  });
  return {
    stats: result.data as MinsalStatistics,
    reclassificationsStamp,
  };
};
