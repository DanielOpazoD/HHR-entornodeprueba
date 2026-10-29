import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type {
  DailyRecordQueryResult,
  DailyRecordQueryRuntime,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import { hasSameComparableValue } from '@/services/repositories/conflictResolutionUtils';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  applyPendingExplicitCensusPatch,
  releaseConfirmedPendingDailyRecordPatches,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

const createProjectionRuntime = (date: string, remote: boolean): DailyRecordQueryRuntime => ({
  date,
  serverConfirmed: true,
  availabilityState: 'resolved',
  consistencyState: remote ? 'remote_authoritative' : 'local_only',
  sourceOfTruth: remote ? 'remote' : 'local',
  retryability: 'not_applicable',
  recoveryAction: 'none',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write', remote ? 'remote_confirmed' : 'local_projection'],
  repairApplied: false,
});

export const didDailyRecordCacheAdvanceBeyondConfirmation = (
  cachedRecord: DailyRecord | null | undefined,
  confirmedRecord: DailyRecord | null | undefined,
  optimisticLastUpdated?: string
) =>
  Boolean(
    cachedRecord &&
    confirmedRecord &&
    cachedRecord.lastUpdated !== optimisticLastUpdated &&
    toRecordTimestamp(cachedRecord.lastUpdated) > toRecordTimestamp(confirmedRecord.lastUpdated)
  );

export const setAcknowledgedDailyRecordQueryData = async (
  queryClient: QueryClient,
  date: string,
  displayRecord: DailyRecord,
  confirmedRecord?: DailyRecord,
  optimisticLastUpdated?: string,
  {
    retainedProjection,
    optimisticRecord,
  }: { retainedProjection?: boolean; optimisticRecord?: DailyRecord } = {}
) => {
  if (!confirmedRecord) {
    setDailyRecordQueryData(queryClient, date, displayRecord);
    return;
  }
  const isConfirmedProjection =
    !retainedProjection && hasSameComparableValue(displayRecord, confirmedRecord);
  const incomingRecord = isConfirmedProjection ? confirmedRecord : displayRecord;
  const queryKey = getDailyRecordQueryKey(date);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<DailyRecordQueryResult>(queryKey, previous => {
    const cachedRecord = previous?.record;
    releaseConfirmedPendingDailyRecordPatches(date, confirmedRecord, cachedRecord ?? undefined);
    const retainCached = Boolean(
      cachedRecord &&
      (isConfirmedProjection ||
        (!hasSameComparableValue(cachedRecord, displayRecord) &&
          (!retainedProjection || !hasSameComparableValue(cachedRecord, confirmedRecord)))) &&
      ((optimisticRecord &&
        !hasSameComparableValue(cachedRecord, optimisticRecord) &&
        !hasSameComparableValue(cachedRecord, confirmedRecord)) ||
        didDailyRecordCacheAdvanceBeyondConfirmation(
          cachedRecord,
          incomingRecord,
          optimisticLastUpdated
        ))
    );
    const record = applyPendingExplicitCensusPatch(
      date,
      retainCached && cachedRecord ? cachedRecord : incomingRecord,
      cachedRecord ?? undefined
    );
    if (
      previous &&
      (retainCached ||
        (!isConfirmedProjection &&
          !retainedProjection &&
          cachedRecord?.lastUpdated === displayRecord.lastUpdated))
    ) {
      return { ...previous, record, runtime: { ...previous.runtime, serverConfirmed: true } };
    }
    return createDailyRecordQueryResult(
      record,
      createProjectionRuntime(date, isConfirmedProjection)
    );
  });
};

/** Publishes an authority-confirmed payload without letting an older write ACK replace newer remote data. */
export const setRemoteConfirmedDailyRecordQueryData = (
  queryClient: QueryClient,
  date: string,
  confirmedRecord: DailyRecord,
  options: { replaceOptimisticLastUpdated?: string; optimisticRecord?: DailyRecord } = {}
) =>
  setAcknowledgedDailyRecordQueryData(
    queryClient,
    date,
    confirmedRecord,
    confirmedRecord,
    options.replaceOptimisticLastUpdated,
    { optimisticRecord: options.optimisticRecord }
  );
