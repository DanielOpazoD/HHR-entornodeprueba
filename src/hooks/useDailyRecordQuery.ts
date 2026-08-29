import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { useRepositories } from '@/services/RepositoryContext';
import { useEffect, useRef } from 'react';
import {
  createDailyRecordQueryFn,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  invalidateDailyRecordQuery,
  prefetchPreviousDailyRecord,
  setDailyRecordQueryData,
  shouldUseDailyRecordRealtimeSync,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  getDailyRecordLastRemoteConfirmedAt,
  markDailyRecordRemoteConfirmed,
  markDailyRecordStaleBaseline,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';
import {
  assertHydratedRemotePatchCanProceed,
  ensureFreshDailyRecordSaveMutation,
  ensureFreshDailyRecordQuery,
  persistDailyRecordSaveMutation,
  prefetchDailyRecordQuery,
  type SaveDailyRecordMutationInput,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
export { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';

export const useDailyRecordQuery = (
  date: string,
  isOfflineMode: boolean = false,
  remoteSyncStatus: RemoteSyncRuntimeStatus = 'local_only'
) => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const shouldSyncFromRemote = shouldUseDailyRecordRealtimeSync(
    date,
    isOfflineMode,
    remoteSyncStatus
  );
  const previousShouldSyncFromRemoteRef = useRef(shouldSyncFromRemote);
  const lastRemoteConfirmedRecordRef = useRef<{ date: string; record: DailyRecord } | null>(null);

  const queryKey = getDailyRecordQueryKey(date);
  const query = useQuery<DailyRecordQueryResult>({
    queryKey,
    queryFn: createDailyRecordQueryFn(dailyRecord, date, shouldSyncFromRemote),
    enabled: !!date,
  });

  useEffect(() => {
    if (!shouldSyncFromRemote || !query.data?.record) {
      return;
    }
    if (
      query.data.runtime.consistencyState === 'unavailable' ||
      query.data.runtime.sourceOfTruth !== 'remote' ||
      query.data.runtime.conflictSummary?.kind === 'remote_unavailable'
    ) {
      return;
    }

    const previousRecord =
      lastRemoteConfirmedRecordRef.current?.date === date
        ? lastRemoteConfirmedRecordRef.current.record
        : null;
    markDailyRecordRemoteConfirmed(date, {
      source: 'query',
      remoteLastUpdated: query.data.record.lastUpdated,
      previousRecord,
      confirmedRecord: query.data.record,
    });
    lastRemoteConfirmedRecordRef.current = { date, record: query.data.record };
  }, [date, query.data, shouldSyncFromRemote]);

  useEffect(() => {
    const didRemoteSyncJustBecomeReady =
      !previousShouldSyncFromRemoteRef.current && shouldSyncFromRemote;
    previousShouldSyncFromRemoteRef.current = shouldSyncFromRemote;

    if (!shouldSyncFromRemote) {
      return;
    }

    if (!didRemoteSyncJustBecomeReady) {
      return;
    }

    void query.refetch();
  }, [query, shouldSyncFromRemote]);

  useEffect(() => {
    if (!shouldSyncFromRemote) return;

    const unsubscribe = createDailyRecordSubscription(dailyRecord, date, queryClient);
    if (!unsubscribe) return;

    return () => unsubscribe();
  }, [date, queryClient, dailyRecord, shouldSyncFromRemote]);

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

    prefetchPreviousDailyRecord(queryClient, dailyRecord, date);
  }, [date, queryClient, dailyRecord, shouldSyncFromRemote]);

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
    mutationFn: (input: SaveDailyRecordMutationInput) =>
      persistDailyRecordSaveMutation(dailyRecord, input),
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
    onSuccess: (payload, _input, context) => {
      if (isDailyRecordWriteRejectedResult(payload.result)) {
        setDailyRecordQueryData(queryClient, payload.record.date, context?.previousRecord ?? null);
        return;
      }
      if (!payload.result?.savedRemotely) return;
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

/**
 * Hook to prefetch a daily record.
 * Useful for prefetching next/previous day's data.
 */
export const usePrefetchDailyRecord = () => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();

  return async (date: string) => {
    await prefetchDailyRecordQuery(queryClient, dailyRecord, date);
    const result = queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date));
    if (
      result?.record &&
      result.runtime.sourceOfTruth === 'remote' &&
      result.runtime.consistencyState !== 'unavailable' &&
      result.runtime.conflictSummary?.kind !== 'remote_unavailable'
    ) {
      markDailyRecordRemoteConfirmed(date, {
        source: 'manual_refresh',
        remoteLastUpdated: result.record.lastUpdated,
      });
    }
  };
};

/**
 * Hook to invalidate daily record cache.
 * Call this after external updates.
 */
export const useInvalidateDailyRecord = () => {
  const queryClient = useQueryClient();

  return (date?: string) => {
    invalidateDailyRecordQuery(queryClient, date);
  };
};

/**
 * Hook for initializing a new daily record.
 */
export const useInitializeDailyRecordMutation = () => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();

  return useMutation({
    mutationFn: async ({ date, copyFromDate }: { date: string; copyFromDate?: string }) => {
      return await dailyRecord.initializeDay(date, copyFromDate);
    },
    onSuccess: newRecord => {
      setDailyRecordQueryData(queryClient, newRecord.date, newRecord);
      invalidateDailyRecordQuery(queryClient, newRecord.date);
    },
  });
};

/**
 * Hook for deleting a daily record.
 */
export const useDeleteDailyRecordMutation = () => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();

  return useMutation({
    mutationFn: async (date: string) => {
      await dailyRecord.deleteDay(date);
      return date;
    },
    onSuccess: date => {
      setDailyRecordQueryData(queryClient, date, null);
      invalidateDailyRecordQuery(queryClient, date);
    },
  });
};
