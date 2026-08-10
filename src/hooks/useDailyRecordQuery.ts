import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { useRepositories } from '@/services/RepositoryContext';
import { useEffect, useRef } from 'react';
import {
  applyOptimisticDailyRecordPatch,
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
import { registerPendingDailyRecordPatch } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';
import {
  assertHydratedRemotePatchCanProceed,
  ensureFreshClinicalPatchMutation,
  ensureFreshClinicalSaveMutation,
  ensureFreshDailyRecordQuery,
  patchDailyRecordWithCompatibility,
  prefetchDailyRecordQuery,
  releasePendingPatchAfterFallbackTtl,
  saveDailyRecordWithCompatibility,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  createDailyRecordPatchBaseRecordRegistry,
  forgetDailyRecordPatchBaseRecord,
  getDailyRecordPatchBaseRecord,
  rememberDailyRecordPatchBaseRecord,
  type DailyRecordPatchBaseRecordRegistry,
} from '@/hooks/controllers/dailyRecordPatchBaseRecordController';

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

/** Full record plus the remote revision from which an optimistic mutation was derived. */
type SaveDailyRecordMutationInput = { record: DailyRecord; expectedLastUpdated?: string; requireConfirmedRecord?: boolean };

export const useSaveDailyRecordMutation = () => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();

  return useMutation({
    mutationFn: async ({ record, expectedLastUpdated, requireConfirmedRecord }: SaveDailyRecordMutationInput) => {
      const options = requireConfirmedRecord ? { requireConfirmedRecord: true } : undefined;
      const result = await saveDailyRecordWithCompatibility(
        dailyRecord,
        record,
        expectedLastUpdated,
        options
      );
      return { record: result?.confirmedRecord ?? record, result };
    },
    onMutate: async ({ record: newRecord, expectedLastUpdated }) => {
      // React Query awaits onMutate before mutationFn. One freshness read is enough; repeating it
      // inside mutationFn can hydrate a second revision and manufacture a conflict with ourselves.
      const freshnessAnchor = expectedLastUpdated
        ? { ...newRecord, lastUpdated: expectedLastUpdated }
        : newRecord;
      await ensureFreshClinicalSaveMutation(freshnessAnchor, { dailyRecord, queryClient });

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

/** Hook for granular partial updates with optimistic cache state. */
export const usePatchDailyRecordMutation = (date: string) => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const patchBaseRecordsRef = useRef<DailyRecordPatchBaseRecordRegistry | null>(null);
  if (patchBaseRecordsRef.current == null) {
    patchBaseRecordsRef.current = createDailyRecordPatchBaseRecordRegistry();
  }
  const patchBaseRecords = patchBaseRecordsRef.current;

  return useMutation({
    mutationFn: async (partial: DailyRecordPatch) => {
      const baseRecord = getDailyRecordPatchBaseRecord(patchBaseRecords, partial);
      const result = await patchDailyRecordWithCompatibility(
        dailyRecord,
        date,
        partial,
        baseRecord ? { baseRecord } : undefined
      );
      return { partial, result };
    },
    onMutate: async partial => {
      const previousRecordBeforeFreshness = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(date)
      )?.record;
      const remoteConfirmedAtBeforeMutation = getDailyRecordLastRemoteConfirmedAt(date);
      const freshness = await ensureFreshClinicalPatchMutation(date, { dailyRecord, queryClient });
      assertHydratedRemotePatchCanProceed({
        date,
        attemptedPatch: partial,
        previousRecord: previousRecordBeforeFreshness,
        freshness,
        remoteConfirmedAtBeforeMutation,
      });
      rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, freshness.record);

      await queryClient.cancelQueries({
        queryKey: queryKeys.dailyRecord.byDate(date),
      });
      const unregisterPendingPatch = registerPendingDailyRecordPatch(date, partial);

      const previousRecord = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(date)
      )?.record;

      if (previousRecord) {
        setDailyRecordQueryData(
          queryClient,
          date,
          applyOptimisticDailyRecordPatch(previousRecord, partial)
        );
      }

      return { previousRecord, unregisterPendingPatch };
    },
    onError: (err, partial, context) => {
      if (context?.previousRecord) {
        setDailyRecordQueryData(queryClient, date, context.previousRecord);
      }
    },
    onSuccess: (payload, _partial, context) => {
      if (isDailyRecordWriteRejectedResult(payload.result)) {
        setDailyRecordQueryData(queryClient, date, context?.previousRecord ?? null);
        return;
      }
      if (!payload.result?.updatedRemotely) return;
      const current = queryClient.getQueryData<DailyRecordQueryResult>(
        getDailyRecordQueryKey(date)
      )?.record;
      if (!current) {
        return;
      }
      markDailyRecordRemoteConfirmed(date, {
        source: 'write',
        remoteLastUpdated: current.lastUpdated,
        confirmedRecord: current,
      });
    },
    onSettled: (payload, error, partial, context) => {
      if (!context?.unregisterPendingPatch) {
        return;
      }
      if (error || isDailyRecordWriteRejectedResult(payload?.result)) {
        context.unregisterPendingPatch();
        forgetDailyRecordPatchBaseRecord(patchBaseRecords, partial);
        return;
      }
      forgetDailyRecordPatchBaseRecord(patchBaseRecords, partial);
      releasePendingPatchAfterFallbackTtl(context.unregisterPendingPatch);
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
