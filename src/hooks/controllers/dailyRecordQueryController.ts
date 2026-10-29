import type { QueryClient, QueryFunctionContext } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';
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
import { markDailyRecordRemoteConfirmed } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { didDailyRecordFreshnessHydrateNewerRemote } from '@/hooks/controllers/dailyRecordFreshnessHydrationController';
import { reconcileDailyRecordQueryResult } from '@/hooks/controllers/dailyRecordQueryResultPrecedence';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';

type DailyRecordReader = Pick<DailyRecordRepositoryPort, 'getForDateWithMeta'>;
type DailyRecordSubscriber = Pick<
  DailyRecordRepositoryPort,
  'getForDateWithMeta' | 'subscribeDetailed'
>;

export const getDailyRecordQueryKey = (date: string) => queryKeys.dailyRecord.byDate(date);

const createDefaultRuntime = (
  date: string,
  record: DailyRecord | null
): DailyRecordQueryRuntime => ({
  date,
  serverConfirmed: false,
  availabilityState: record ? 'resolved' : 'unconfirmed_missing',
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

const createRuntimeFromResult = (
  date: string,
  result: DailyRecordReadResult | SyncDailyRecordResult
): DailyRecordQueryRuntime => {
  const {
    consistencyState,
    record,
    sourceOfTruth,
    retryability,
    serverConfirmed,
    conflictSummary,
  } = result;
  const isSync = 'outcome' in result;
  const recoverable = isSync
    ? consistencyState === 'local_kept' || consistencyState === 'blocked'
    : retryability !== 'not_applicable' || sourceOfTruth === 'local';
  const unavailable = isSync ? consistencyState === 'blocked' : consistencyState === 'unavailable';
  const missing = isSync
    ? consistencyState === 'missing_remote'
    : conflictSummary?.kind === 'remote_missing';
  return {
    date,
    serverConfirmed,
    availabilityState: record
      ? recoverable
        ? 'recoverable_local'
        : 'resolved'
      : unavailable
        ? 'temporarily_unavailable'
        : serverConfirmed && missing
          ? 'confirmed_missing'
          : 'unconfirmed_missing',
    consistencyState,
    sourceOfTruth,
    retryability,
    recoveryAction: result.recoveryAction,
    conflictSummary,
    observabilityTags: result.observabilityTags,
    userSafeMessage: result.userSafeMessage,
    repairApplied: result.repairApplied,
  };
};

export const createDailyRecordQueryFn =
  (dailyRecord: DailyRecordReader, date: string, syncFromRemote: boolean = true) =>
  async (): Promise<DailyRecordQueryResult> => {
    const query = createGetDailyRecordQuery(date, syncFromRemote);
    const result = await dailyRecord.getForDateWithMeta(query.date, query.syncFromRemote);
    return createDailyRecordQueryResult(
      result.record,
      createRuntimeFromResult(result.date, result)
    );
  };

const confirmAcceptedDailyRecordRead = (
  date: string,
  { record, runtime }: DailyRecordQueryResult,
  previousRecord: DailyRecord | null | undefined,
  source: 'query' | 'subscription'
) => {
  if (
    !record ||
    !runtime.serverConfirmed ||
    runtime.consistencyState === 'unavailable' ||
    runtime.conflictSummary?.kind === 'remote_unavailable'
  ) {
    return;
  }
  markDailyRecordRemoteConfirmed(date, {
    source,
    ...(runtime.sourceOfTruth === 'remote'
      ? {
          remoteLastUpdated: record.lastUpdated,
          remoteHydratedNewerRecord: didDailyRecordFreshnessHydrateNewerRemote({ record, runtime }),
          previousRecord,
          confirmedRecord: record,
        }
      : {}),
  });
};

export const createReconciledDailyRecordQueryFn = (
  dailyRecord: DailyRecordReader,
  date: string,
  queryClient: QueryClient,
  syncFromRemote: boolean = true
) => {
  const queryFn = createDailyRecordQueryFn(dailyRecord, date, syncFromRemote);
  return async (context?: Pick<QueryFunctionContext, 'signal'>) => {
    const signal = context?.signal;
    const key = getDailyRecordQueryKey(date);
    const startedWith = queryClient.getQueryData<DailyRecordQueryResult>(key);
    const incoming = await queryFn();
    signal?.throwIfAborted();
    const current = queryClient.getQueryData<DailyRecordQueryResult>(key);
    // A newer realtime record owns the cache. An older in-flight miss must not
    // erase it, even when that miss was authoritative when the request began.
    if (!incoming.record && current?.record && current !== startedWith) {
      return { ...current, runtime: { ...current.runtime, serverConfirmed: false } };
    }
    const reconciled = reconcileDailyRecordQueryResult(current, incoming);
    confirmAcceptedDailyRecordRead(date, reconciled, current?.record, 'query');
    return reconciled;
  };
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
  dailyRecord: DailyRecordSubscriber,
  date: string,
  queryClient: QueryClient
) => {
  let isSubscriptionActive = true;
  let realtimeRevision = 0;
  const queryKey = getDailyRecordQueryKey(date);

  const applyResolvedQueryResult = (result: DailyRecordQueryResult) =>
    queryClient.setQueryData(queryKey, result);

  const applyResolvedRecord = (
    result: DailyRecordQueryResult,
    previousResult: DailyRecordQueryResult | undefined,
    remoteCandidate?: DailyRecordQueryResult
  ) => {
    const { record, runtime } = result;
    if (
      remoteCandidate?.record &&
      remoteCandidate.runtime.serverConfirmed &&
      remoteCandidate.runtime.sourceOfTruth === 'remote'
    ) {
      releaseConfirmedPendingDailyRecordPatches(
        date,
        remoteCandidate.record,
        previousResult?.record ?? undefined
      );
    }
    const resolvedRecord = record
      ? applyPendingExplicitCensusPatch(date, record, previousResult?.record ?? undefined)
      : record;
    applyResolvedQueryResult({
      ...result,
      record: resolvedRecord,
      runtime:
        resolvedRecord === record
          ? runtime
          : {
              ...runtime,
              baseSource: runtime.baseSource ?? runtime.sourceOfTruth,
              sourceOfTruth: 'local',
            },
    });
  };

  const reconcileNullRealtimeRecord = (previousResult: DailyRecordQueryResult) => {
    const recoveryRevision = realtimeRevision;
    const recoveryQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
    const recoveryState = recoveryQuery?.state;
    const ownsRecovery = () =>
      isSubscriptionActive &&
      recoveryRevision === realtimeRevision &&
      queryClient.getQueryCache().find({ queryKey, exact: true }) === recoveryQuery &&
      recoveryQuery?.state === recoveryState;
    const read = dailyRecord.getForDateWithMeta(date);

    void read
      .then(reconciledResult => {
        if (!ownsRecovery()) {
          return;
        }
        const recovered = createDailyRecordQueryResult(
          reconciledResult.record,
          createRuntimeFromResult(reconciledResult.date, reconciledResult)
        );
        const resolved = reconcileDailyRecordQueryResult(previousResult, recovered);
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
              retainedPreviousRecord: resolved.record === previousResult.record,
              consistencyState: recovered.runtime.consistencyState,
              availabilityState: recovered.runtime.availabilityState,
            },
          });
          if (resolved === previousResult) return;
          if (resolved.record === previousResult.record) {
            // Retaining cached data is not an acknowledgement of pending edits.
            applyResolvedQueryResult(resolved);
          } else {
            applyResolvedRecord(
              resolved,
              previousResult,
              resolved === recovered ? recovered : undefined
            );
          }
          return;
        }

        const confirmedMissing = recovered.runtime.availabilityState === 'confirmed_missing';
        dailyRecordObservability.recordEvent(
          confirmedMissing ? 'confirmed_null_realtime_record' : 'unavailable_null_realtime_record',
          'degraded',
          {
            date,
            runtimeState: confirmedMissing ? 'retryable' : 'blocked',
            issues: [
              confirmedMissing
                ? 'El repositorio confirmó la ausencia del registro después de una suscripción realtime nula.'
                : 'No se pudo confirmar la existencia del registro después de una suscripción realtime nula.',
            ],
            context: {
              previousLastUpdated: previousResult.record?.lastUpdated,
              consistencyState: recovered.runtime.consistencyState,
              availabilityState: recovered.runtime.availabilityState,
            },
          }
        );
        applyResolvedQueryResult(resolved);
      })
      .catch(error => {
        if (!ownsRecovery()) {
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
        applyResolvedQueryResult({
          ...previousResult,
          runtime: { ...previousResult.runtime, serverConfirmed: false },
        });
      });
  };

  const handleResolvedRealtimeResult = (
    result: DailyRecordQueryResult,
    hasPendingWrites: boolean
  ) => {
    if (!isSubscriptionActive || hasPendingWrites) {
      return;
    }

    realtimeRevision += 1;
    const previousResult = queryClient.getQueryData<DailyRecordQueryResult>(queryKey);
    if (result.record) {
      const reconciled = reconcileDailyRecordQueryResult(previousResult, result);
      if (reconciled === previousResult) {
        return;
      }
      applyResolvedRecord(reconciled, previousResult, reconciled === result ? result : undefined);
      confirmAcceptedDailyRecordRead(date, reconciled, previousResult?.record, 'subscription');
      return;
    }

    if (!previousResult?.record) {
      applyResolvedQueryResult(result);
      return;
    }

    reconcileNullRealtimeRecord(previousResult);
  };

  const stop = dailyRecord.subscribeDetailed(
    date,
    (result, hasPendingWrites) => {
      handleResolvedRealtimeResult(
        createDailyRecordQueryResult(result.record, createRuntimeFromResult(date, result)),
        hasPendingWrites
      );
    },
    result => {
      if (!isSubscriptionActive) return;
      realtimeRevision += 1;
      applyResolvedQueryResult(
        reconcileDailyRecordQueryResult(
          queryClient.getQueryData<DailyRecordQueryResult>(queryKey),
          createDailyRecordQueryResult(null, createRuntimeFromResult(date, result))
        )
      );
    }
  );
  return () => {
    isSubscriptionActive = false;
    stop();
  };
};

export const buildPreviousDayDate = (date: string) => {
  const currentDate = new Date(`${date}T12:00:00`);
  currentDate.setDate(currentDate.getDate() - 1);
  // clinical-clock-allow instant-calendar-slice: currentDate is calendar arithmetic from the requested day at noon, not an event instant.
  return currentDate.toISOString().split('T')[0];
};

export const prefetchPreviousDailyRecord = (
  queryClient: QueryClient,
  dailyRecord: DailyRecordReader,
  date: string
) =>
  queryClient.prefetchQuery({
    queryKey: getDailyRecordQueryKey(buildPreviousDayDate(date)),
    queryFn: createReconciledDailyRecordQueryFn(
      dailyRecord,
      buildPreviousDayDate(date),
      queryClient
    ),
    staleTime: 5 * 60 * 1000,
  });

/** Publishes a server read after a rejected command without acknowledging pending writes. */
export const setAuthoritativeDailyRecordRead = (
  queryClient: QueryClient,
  date: string,
  record: DailyRecord
) =>
  queryClient.setQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date), previous => {
    const selected = applyPendingExplicitCensusPatch(
      date,
      record,
      previous?.record ?? undefined,
      hasSamePatientEpisodeIdentity
    );
    return createQueryResultFromRecord(date, selected, {
      ...createDefaultRuntime(date, record),
      serverConfirmed: true,
      baseSource: 'remote',
      consistencyState: 'remote_authoritative',
      sourceOfTruth: selected === record ? 'remote' : 'local',
      observabilityTags: ['daily_record', 'read', 'remote_confirmed'],
    });
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
          ? { ...previousResult.runtime, serverConfirmed: false }
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
