import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type {
  DailyRecordQueryResult,
  DailyRecordQueryRuntime,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  applyPendingExplicitCensusPatch,
  releaseConfirmedPendingDailyRecordPatches,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

const createRemoteConfirmedRuntime = (date: string): DailyRecordQueryRuntime => ({
  date,
  availabilityState: 'resolved',
  consistencyState: 'remote_authoritative',
  sourceOfTruth: 'remote',
  retryability: 'not_applicable',
  recoveryAction: 'none',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write', 'remote_confirmed'],
  repairApplied: false,
});

const createLocalProjectionRuntime = (date: string): DailyRecordQueryRuntime => ({
  date,
  availabilityState: 'resolved',
  consistencyState: 'local_only',
  sourceOfTruth: 'local',
  retryability: 'not_applicable',
  recoveryAction: 'none',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write', 'local_projection'],
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

/** Publishes an authority-confirmed payload without letting an older write ACK replace newer remote data. */
export const setRemoteConfirmedDailyRecordQueryData = async (
  queryClient: QueryClient,
  date: string,
  confirmedRecord: DailyRecord,
  options: { replaceOptimisticLastUpdated?: string } = {}
) => {
  const queryKey = getDailyRecordQueryKey(date);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date), previous => {
    releaseConfirmedPendingDailyRecordPatches(date, confirmedRecord, previous?.record ?? undefined);
    if (
      previous?.record &&
      previous.record.lastUpdated !== options.replaceOptimisticLastUpdated &&
      toRecordTimestamp(previous.record.lastUpdated) >
        toRecordTimestamp(confirmedRecord.lastUpdated)
    ) {
      return {
        ...previous,
        record: applyPendingExplicitCensusPatch(date, previous.record, previous.record),
      };
    }

    const displayRecord = applyPendingExplicitCensusPatch(
      date,
      confirmedRecord,
      previous?.record ?? undefined
    );
    return createDailyRecordQueryResult(displayRecord, createRemoteConfirmedRuntime(date));
  });
};

export const setAcknowledgedDailyRecordQueryData = async (
  queryClient: QueryClient,
  date: string,
  displayRecord: DailyRecord,
  confirmedRecord?: DailyRecord,
  optimisticLastUpdated?: string
) => {
  const isConfirmedProjection = Boolean(
    confirmedRecord && displayRecord.lastUpdated === confirmedRecord.lastUpdated
  );
  if (!confirmedRecord) {
    setDailyRecordQueryData(queryClient, date, displayRecord);
    return;
  }
  if (!isConfirmedProjection) {
    const queryKey = getDailyRecordQueryKey(date);
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<DailyRecordQueryResult>(queryKey, previous => {
      releaseConfirmedPendingDailyRecordPatches(
        date,
        confirmedRecord,
        previous?.record ?? undefined
      );
      if (
        previous?.record &&
        previous.record.lastUpdated !== optimisticLastUpdated &&
        toRecordTimestamp(previous.record.lastUpdated) >
          toRecordTimestamp(displayRecord.lastUpdated)
      ) {
        return {
          ...previous,
          record: applyPendingExplicitCensusPatch(date, previous.record, previous.record),
        };
      }
      const reconciledDisplay = applyPendingExplicitCensusPatch(
        date,
        displayRecord,
        previous?.record ?? undefined
      );
      if (previous?.record?.lastUpdated === displayRecord.lastUpdated) {
        return { ...previous, record: reconciledDisplay };
      }
      return createDailyRecordQueryResult(reconciledDisplay, createLocalProjectionRuntime(date));
    });
    return;
  }
  await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedRecord, {
    replaceOptimisticLastUpdated: optimisticLastUpdated,
  });
};
