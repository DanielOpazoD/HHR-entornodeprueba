import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { applyPatches } from '@/utils/patchUtils';
import {
  applyPendingExplicitCensusPatch,
  releaseConfirmedPendingDailyRecordPatches,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import {
  createDailyRecordQueryResult,
  createGetDailyRecordQuery,
  type DailyRecordQueryResult,
  type DailyRecordQueryRuntime,
  type DailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import {
  getFirestoreSyncState,
  type FirestoreSyncState,
  type RemoteSyncRuntimeStatus,
} from '@/services/repositories/repositoryConfig';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { toRecordTimestamp } from '@/services/repositories/dailyRecordConsistencyPolicy';
import { markDailyRecordRemoteConfirmed } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { didDailyRecordFreshnessHydrateNewerRemote } from '@/hooks/controllers/dailyRecordFreshnessHydrationController';

interface DailyRecordReader {
  getForDate: (date: string) => Promise<DailyRecord | null>;
  getForDateWithMeta?: (date: string, syncFromRemote?: boolean) => Promise<DailyRecordReadResult>;
  subscribe?: (
    date: string,
    callback: (record: DailyRecord | null, hasPendingWrites: boolean) => void
  ) => () => void;
  subscribeDetailed?: (
    date: string,
    callback: (result: SyncDailyRecordResult, hasPendingWrites: boolean) => void
  ) => () => void;
}

export const getDailyRecordQueryKey = (date: string) => queryKeys.dailyRecord.byDate(date);

const createDefaultRuntime = (
  date: string,
  record: DailyRecord | null
): DailyRecordQueryRuntime => ({
  date,
  availabilityState: record ? 'resolved' : 'confirmed_missing',
  consistencyState: record ? 'local_only' : 'missing',
  sourceOfTruth: record ? 'local' : 'none',
  retryability: 'not_applicable',
  recoveryAction: 'none',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read'],
  repairApplied: false,
});

const createQueryResultFromRecord = (
  date: string,
  record: DailyRecord | null,
  runtime: DailyRecordQueryRuntime = createDefaultRuntime(date, record)
): DailyRecordQueryResult => createDailyRecordQueryResult(record, runtime);

const createRuntimeFromReadResult = (result: DailyRecordReadResult): DailyRecordQueryRuntime => ({
  date: result.date,
  availabilityState: result.record
    ? result.retryability !== 'not_applicable' || result.sourceOfTruth === 'local'
      ? 'recoverable_local'
      : 'resolved'
    : result.consistencyState === 'unavailable'
      ? 'temporarily_unavailable'
      : 'confirmed_missing',
  consistencyState: result.consistencyState,
  sourceOfTruth: result.sourceOfTruth,
  retryability: result.retryability,
  recoveryAction: result.recoveryAction,
  conflictSummary: result.conflictSummary,
  observabilityTags: result.observabilityTags,
  userSafeMessage: result.userSafeMessage,
  repairApplied: result.repairApplied,
});

const createRuntimeFromSyncResult = (
  date: string,
  result: SyncDailyRecordResult
): DailyRecordQueryRuntime => ({
  date,
  availabilityState: result.record
    ? result.consistencyState === 'local_kept' || result.consistencyState === 'blocked'
      ? 'recoverable_local'
      : 'resolved'
    : result.consistencyState === 'blocked'
      ? 'temporarily_unavailable'
      : 'confirmed_missing',
  consistencyState: result.consistencyState,
  sourceOfTruth: result.sourceOfTruth,
  retryability: result.retryability,
  recoveryAction: result.recoveryAction,
  conflictSummary: result.conflictSummary,
  observabilityTags: result.observabilityTags,
  userSafeMessage: result.userSafeMessage,
  repairApplied: result.repairApplied,
});

export const createDailyRecordQueryFn =
  (dailyRecord: DailyRecordReader, date: string, syncFromRemote: boolean = true) =>
  async (): Promise<DailyRecordQueryResult> => {
    const query = createGetDailyRecordQuery(date, syncFromRemote);
    if (typeof dailyRecord.getForDateWithMeta === 'function') {
      const result = await dailyRecord.getForDateWithMeta(query.date, query.syncFromRemote);
      return createDailyRecordQueryResult(result.record, createRuntimeFromReadResult(result));
    }

    const record = await dailyRecord.getForDate(query.date);
    return createQueryResultFromRecord(query.date, record);
  };

export const shouldUseDailyRecordRealtimeSync = (
  date: string,
  isOfflineMode: boolean,
  remoteSyncStatus: RemoteSyncRuntimeStatus,
  firestoreSyncState: FirestoreSyncState = getFirestoreSyncState()
) =>
  Boolean(date) &&
  !isOfflineMode &&
  remoteSyncStatus === 'ready' &&
  firestoreSyncState.mode === 'enabled';

export const createDailyRecordSubscription = (
  dailyRecord: DailyRecordReader,
  date: string,
  queryClient: QueryClient
) => {
  let isSubscriptionActive = true;
  if (!dailyRecord.subscribe) {
    if (!dailyRecord.subscribeDetailed) {
      return null;
    }
  }

  const applyResolvedQueryResult = (result: DailyRecordQueryResult) => {
    queryClient.setQueryData(getDailyRecordQueryKey(date), result);
  };

  const applyResolvedRecord = (
    result: DailyRecordQueryResult,
    previousResult: DailyRecordQueryResult | undefined
  ) => {
    if (result.record) {
      releaseConfirmedPendingDailyRecordPatches(
        date,
        result.record,
        previousResult?.record ?? undefined
      );
    }
    const resolvedRecord = result.record
      ? applyPendingExplicitCensusPatch(date, result.record, previousResult?.record ?? undefined)
      : result.record;
    applyResolvedQueryResult({
      ...result,
      record: resolvedRecord,
    });
  };

  const shouldPreservePreviousRecord = (
    previousResult: DailyRecordQueryResult | undefined,
    incomingResult: DailyRecordQueryResult
  ): boolean => {
    if (!previousResult?.record || !incomingResult.record) {
      return false;
    }

    if (
      previousResult.runtime.sourceOfTruth === 'local' &&
      incomingResult.runtime.sourceOfTruth !== 'local'
    ) {
      return false;
    }

    return (
      toRecordTimestamp(previousResult.record.lastUpdated) >
      toRecordTimestamp(incomingResult.record.lastUpdated)
    );
  };

  const reconcileNullRealtimeRecord = (previousResult: DailyRecordQueryResult) => {
    const read =
      typeof dailyRecord.getForDateWithMeta === 'function'
        ? dailyRecord.getForDateWithMeta(date)
        : dailyRecord.getForDate(date).then<DailyRecordReadResult>(record => ({
            date,
            record,
            consistencyState: record ? 'local_only' : 'missing',
            sourceOfTruth: record ? 'local' : 'none',
            retryability: 'not_applicable',
            recoveryAction: 'none',
            conflictSummary: null,
            observabilityTags: ['daily_record', 'read'],
            repairApplied: false,
            compatibilityTier: 'none',
            compatibilityIntensity: 'none',
            migrationRulesApplied: [],
            source: record ? 'indexeddb' : 'not_found',
          }));

    void read
      .then(reconciledResult => {
        if (!isSubscriptionActive) {
          return;
        }
        const recovered = createDailyRecordQueryResult(
          reconciledResult.record,
          createRuntimeFromReadResult(reconciledResult)
        );
        if (recovered.record) {
          dailyRecordObservability.recordEvent('recovered_null_realtime_record', 'degraded', {
            date,
            runtimeState: 'recoverable',
            issues: [
              'Se evitó un vaciado transitorio del registro después de una suscripción realtime nula.',
            ],
            context: {
              previousLastUpdated: previousResult.record?.lastUpdated,
              recoveredLastUpdated: recovered.record.lastUpdated,
              consistencyState: recovered.runtime.consistencyState,
              availabilityState: recovered.runtime.availabilityState,
            },
          });
          applyResolvedQueryResult(recovered);
          return;
        }

        dailyRecordObservability.recordEvent('confirmed_null_realtime_record', 'degraded', {
          date,
          runtimeState:
            recovered.runtime.availabilityState === 'temporarily_unavailable'
              ? 'blocked'
              : 'retryable',
          issues: [
            'La suscripción realtime emitió null y el repositorio confirmó ausencia o indisponibilidad del registro.',
          ],
          context: {
            previousLastUpdated: previousResult.record?.lastUpdated,
            consistencyState: recovered.runtime.consistencyState,
            availabilityState: recovered.runtime.availabilityState,
          },
        });
        applyResolvedQueryResult(recovered);
      })
      .catch(error => {
        if (!isSubscriptionActive) {
          return;
        }
        dailyRecordObservability.recordError(
          'reconcile_null_realtime_record',
          error,
          {
            code: 'daily_record_realtime_null_reconciliation_failed',
            message: 'No fue posible reconciliar un registro nulo emitido por realtime.',
            severity: 'warning',
            userSafeMessage: 'Se mantuvo la copia local mientras se revalida el registro del día.',
          },
          {
            date,
            context: {
              previousLastUpdated: previousResult.record?.lastUpdated,
            },
          }
        );
        applyResolvedQueryResult(previousResult);
      });
  };

  const handleResolvedRealtimeResult = (
    result: DailyRecordQueryResult,
    hasPendingWrites: boolean
  ) => {
    if (hasPendingWrites) {
      return;
    }

    const previousResult = queryClient.getQueryData<DailyRecordQueryResult>(
      getDailyRecordQueryKey(date)
    );
    if (result.record) {
      if (shouldPreservePreviousRecord(previousResult, result)) {
        return;
      }
      applyResolvedRecord(result, previousResult);
      if (
        result.runtime.consistencyState !== 'unavailable' &&
        result.runtime.conflictSummary?.kind !== 'remote_unavailable'
      ) {
        markDailyRecordRemoteConfirmed(date, {
          source: 'subscription',
          remoteLastUpdated: result.record.lastUpdated,
          remoteHydratedNewerRecord: didDailyRecordFreshnessHydrateNewerRemote(result),
          previousRecord: previousResult?.record,
          confirmedRecord: result.record,
        });
      }
      return;
    }

    const existingResult =
      previousResult || createQueryResultFromRecord(date, null, result.runtime);
    if (!existingResult.record) {
      applyResolvedQueryResult(result);
      return;
    }

    reconcileNullRealtimeRecord(existingResult);
  };

  if (typeof dailyRecord.subscribeDetailed === 'function') {
    const stop = dailyRecord.subscribeDetailed(date, (result, hasPendingWrites) => {
      if (!isSubscriptionActive) {
        return;
      }
      handleResolvedRealtimeResult(
        createDailyRecordQueryResult(result.record, createRuntimeFromSyncResult(date, result)),
        hasPendingWrites
      );
    });
    return () => {
      isSubscriptionActive = false;
      stop();
    };
  }

  const stop = dailyRecord.subscribe!(date, (record, hasPendingWrites) => {
    if (!isSubscriptionActive) {
      return;
    }
    handleResolvedRealtimeResult(createQueryResultFromRecord(date, record), hasPendingWrites);
  });
  return () => {
    isSubscriptionActive = false;
    stop();
  };
};

export const buildPreviousDayDate = (date: string) => {
  const currentDate = new Date(`${date}T12:00:00`);
  currentDate.setDate(currentDate.getDate() - 1);
  return currentDate.toISOString().split('T')[0];
};

export const prefetchPreviousDailyRecord = (
  queryClient: QueryClient,
  dailyRecord: DailyRecordReader,
  date: string
) =>
  queryClient.prefetchQuery({
    queryKey: getDailyRecordQueryKey(buildPreviousDayDate(date)),
    queryFn: createDailyRecordQueryFn(dailyRecord, buildPreviousDayDate(date)),
    staleTime: 5 * 60 * 1000,
  });

export const setDailyRecordQueryData = (
  queryClient: QueryClient,
  date: string,
  updater: DailyRecord | null | ((previous: DailyRecord | null) => DailyRecord | null)
) => {
  queryClient.setQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date), previous => {
    const previousResult = previous || createQueryResultFromRecord(date, null);
    const nextRecord = typeof updater === 'function' ? updater(previousResult.record) : updater;
    return createQueryResultFromRecord(
      date,
      nextRecord,
      nextRecord
        ? createDefaultRuntime(date, nextRecord)
        : previousResult.runtime.availabilityState === 'temporarily_unavailable'
          ? previousResult.runtime
          : createDefaultRuntime(date, null)
    );
  });
};

export const invalidateDailyRecordQuery = (queryClient: QueryClient, date?: string) => {
  if (date) {
    queryClient.invalidateQueries({ queryKey: getDailyRecordQueryKey(date) });
    return;
  }

  queryClient.invalidateQueries({ queryKey: queryKeys.dailyRecord.all });
};

export const applyOptimisticDailyRecordPatch = (
  previousRecord: DailyRecord,
  partial: DailyRecordPatch
) => {
  const updatedRecord = applyPatches(previousRecord, partial);
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};
