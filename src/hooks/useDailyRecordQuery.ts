import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import { useRepositories } from '@/services/RepositoryContext';
import { useEffect, useRef } from 'react';
import {
  createDailyRecordQueryOptions,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  invalidateDailyRecordQuery,
  prefetchPreviousDailyRecord,
  setDailyRecordQueryData,
  shouldUseDailyRecordRealtimeSync,
} from '@/hooks/controllers/dailyRecordQueryController';
import { setAcknowledgedDailyRecordQueryData } from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import {
  markDailyRecordRemoteConfirmed,
  markDailyRecordStaleBaseline,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import {
  recordCensusRemoteEnabled,
  recordCensusSubscriptionStart,
} from '@/shared/runtime/censusStartupPerf';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';
import {
  ensureFreshDailyRecordSaveMutation,
  ensureFreshDailyRecordQuery,
  type SaveDailyRecordMutationInput,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
export { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';

/**
 * The live subscription is gated on the real runtime status, not on the deferred one.
 * Deferring the first remote read smooths initial render; deferring the listener only
 * delays the moment the census can be trusted as server-confirmed.
 */
export const useDailyRecordQuery = (
  date: string,
  isOfflineMode: boolean = false,
  remoteSyncStatus: RemoteSyncRuntimeStatus = 'local_only',
  subscriptionSyncStatus: RemoteSyncRuntimeStatus = remoteSyncStatus
) => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const shouldSyncFromRemote = shouldUseDailyRecordRealtimeSync(
    date,
    isOfflineMode,
    remoteSyncStatus
  );
  const shouldSubscribeFromRemote = shouldUseDailyRecordRealtimeSync(
    date,
    isOfflineMode,
    subscriptionSyncStatus
  );
  const previousShouldSyncFromRemoteRef = useRef(shouldSyncFromRemote);
  const prefetchedPreviousForRef = useRef<string | null>(null);

  const query = useQuery<DailyRecordQueryResult>({
    ...createDailyRecordQueryOptions(dailyRecord, date, queryClient, shouldSyncFromRemote),
    enabled: !!date,
    // Negative cache entries must be revalidated on every visit. Another workstation
    // may have created this census since the previous confirmed absence.
    staleTime: query => {
      if (!query.state.data?.record) return 0;
      const configured = queryClient.getDefaultOptions().queries?.staleTime;
      return typeof configured === 'number' || configured === 'static' ? configured : 0;
    },
    // Brief tab returns can reuse fresh data; stale resumes pass through the freshness gate.
    // A reconnect always re-checks, even fresh data: a short network loss with the page
    // visible never reaches the inactivity gate (its 'online' handler needs a hidden tab).
    refetchOnWindowFocus: true,
    refetchOnReconnect: 'always',
  });

  const hasConfirmedRemoteRead =
    query.isFetchedAfterMount &&
    query.data?.record &&
    query.data.runtime.serverConfirmed &&
    query.data.runtime.consistencyState !== 'unavailable' &&
    query.data.runtime.conflictSummary?.kind !== 'remote_unavailable';

  useEffect(() => {
    const didRemoteSyncJustBecomeReady =
      !previousShouldSyncFromRemoteRef.current && shouldSyncFromRemote;
    previousShouldSyncFromRemoteRef.current = shouldSyncFromRemote;

    if (!shouldSyncFromRemote) {
      return;
    }

    recordCensusRemoteEnabled(date);

    if (!didRemoteSyncJustBecomeReady) {
      return;
    }

    // The listener now opens before this flip, so it may already have delivered the
    // server document. Skipping the duplicate read only when the server has actually
    // confirmed keeps the remote-hydration guarantee intact in every other case.
    if (hasConfirmedRemoteRead) {
      return;
    }

    void query.refetch();
  }, [date, query, shouldSyncFromRemote, hasConfirmedRemoteRead]);

  useEffect(() => {
    if (!shouldSubscribeFromRemote) return;

    recordCensusSubscriptionStart(date);
    return createDailyRecordSubscription(dailyRecord, date, queryClient);
  }, [date, queryClient, dailyRecord, shouldSubscribeFromRemote]);

  useEffect(() => {
    if (!shouldSyncFromRemote) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleResume = () => {
      const resumeState = markDailyRecordTabVisible();
      if (!resumeState.stale) {
        return;
      }

      markDailyRecordStaleBaseline(
        date,
        queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record ??
          null
      );
      void ensureFreshDailyRecordQuery(date, { dailyRecord, queryClient }, 'resume');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markDailyRecordTabHidden();
        return;
      }

      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleResume);
    window.addEventListener('online', handleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('online', handleResume);
    };
  }, [dailyRecord, date, queryClient, shouldSyncFromRemote]);

  useEffect(() => {
    if (!shouldSyncFromRemote) return;
    if (import.meta.env.DEV) return;
    // Only after the current day is server-confirmed: the previous day is a
    // convenience, and it used to compete with the census for the same connection.
    if (!hasConfirmedRemoteRead) return;
    // Once per selected day. Each live update of today re-runs this effect, and the
    // 5-minute stale window turned that into a full re-read of yesterday every 5 minutes.
    if (prefetchedPreviousForRef.current === date) return;
    prefetchedPreviousForRef.current = date;

    prefetchPreviousDailyRecord(queryClient, dailyRecord, date);
  }, [date, queryClient, dailyRecord, shouldSyncFromRemote, hasConfirmedRemoteRead]);

  return {
    ...query,
    data: query.data?.record ?? null,
    runtime: query.data?.runtime ?? null,
  };
};

export const useSaveDailyRecordMutation = () => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();

  return useMutation({
    mutationFn: async (input: SaveDailyRecordMutationInput) => {
      const { persistDailyRecordSaveMutation } =
        await import('@/hooks/controllers/dailyRecordSavePersistenceController');
      return persistDailyRecordSaveMutation(dailyRecord, input);
    },
    onMutate: async (input: SaveDailyRecordMutationInput) => {
      const newRecord = input.record;
      await ensureFreshDailyRecordSaveMutation(input, { dailyRecord, queryClient });

      await queryClient.cancelQueries({
        queryKey: queryKeys.dailyRecord.byDate(newRecord.date),
      });

      const previousRecord = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(newRecord.date)
      )?.record;

      setDailyRecordQueryData(queryClient, newRecord.date, newRecord);

      return { previousRecord };
    },
    onError: (err, { record: newRecord }, context) => {
      if (context?.previousRecord) {
        setDailyRecordQueryData(queryClient, newRecord.date, context.previousRecord);
      }
    },
    onSuccess: async (payload, input, context) => {
      if (isDailyRecordWriteRejectedResult(payload.result)) {
        setDailyRecordQueryData(queryClient, payload.record.date, context?.previousRecord ?? null);
        return;
      }
      if (!payload.result?.savedRemotely) return;
      if (payload.result.confirmedRecord) {
        await setAcknowledgedDailyRecordQueryData(
          queryClient,
          payload.record.date,
          payload.result.localProjectionRecord ?? payload.result.confirmedRecord,
          payload.result.confirmedRecord,
          input.record.lastUpdated,
          {
            retainedProjection: Boolean(payload.result.localProjectionRecord),
            optimisticRecord: input.record,
          }
        );
      }
      markDailyRecordRemoteConfirmed(payload.record.date, {
        source: 'write',
        remoteLastUpdated: payload.record.lastUpdated,
        confirmedRecord: payload.record,
      });
    },
    onSettled: payload => {
      if (payload?.record) {
        invalidateDailyRecordQuery(queryClient, payload.record.date);
      }
    },
  });
};
