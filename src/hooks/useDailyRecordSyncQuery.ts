/**
 * useDailyRecordSyncQuery Hook
 * Replaces useDailyRecordSync logic with TanStack Query.
 * Provides the same interface for compatibility.
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  useDailyRecordQuery,
  useSaveDailyRecordMutation,
  usePatchDailyRecordMutation,
  useInitializeDailyRecordMutation,
  useDeleteDailyRecordMutation,
} from './useDailyRecordQuery';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import { SyncStatus, UseDailyRecordSyncResult } from '@/context/dailyRecordContextContracts';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { useRepositories } from '@/services/RepositoryContext';
import { useNotification } from '@/context/UIContext';
import { useVersion } from '@/context/VersionContext';
import {
  resolvePatchOutcomeFeedback,
  resolveSaveErrorFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { assertDailyRecordWriteAccepted } from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import {
  buildCreateDaySuccessMessage,
  resolveCreateDaySourceDate,
  resolveMutationSyncStatus,
} from '@/hooks/controllers/dailyRecordSyncController';
import { presentDailyRecordRefreshOutcome } from '@/hooks/controllers/dailyRecordRefreshOutcomeController';
import { dailyRecordSyncLogger } from '@/hooks/hookLoggers';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import { DailyRecordFreshnessGateError } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';
import {
  resolveDailyRecordBootstrapPhase,
  type DailyRecordBootstrapPhase,
} from '@/hooks/controllers/dailyRecordBootstrapController';
import {
  useDeferredRemoteHydration,
  usePostDeployRecentRecordRefresh,
  useRemoteDailyRecordSync,
  useTodayEmptyDailyRecordRecovery,
} from '@/hooks/useDailyRecordSyncQuerySupport';
import { flushPerfReport, markPerf } from '@/shared/runtime/perfAudit';

type ChannelNotice = {
  channel: 'warning' | 'error' | null;
  title?: string;
  message?: string;
};

export const useDailyRecordSyncQuery = (
  currentDateString: string,
  _isOfflineMode: boolean = false, // Handled implicitly by TanStack Query & Repository
  remoteSyncStatus: RemoteSyncRuntimeStatus = 'local_only'
): UseDailyRecordSyncResult => {
  const queryClient = useQueryClient();
  const { dailyRecord } = useRepositories();
  const { checkVersion } = useVersion();
  const effectiveRemoteSyncStatus = useDeferredRemoteHydration(currentDateString, remoteSyncStatus);

  // 1. Fetching
  const {
    data: record,
    runtime: recordRuntime,
    dataUpdatedAt,
    refetch,
  } = useDailyRecordQuery(currentDateString, _isOfflineMode, effectiveRemoteSyncStatus);

  // Monitor version in incoming records
  useEffect(() => {
    if (record?.schemaVersion) {
      checkVersion(record.schemaVersion);
    }
  }, [record, checkVersion]);

  // 2. Mutations
  const saveMutation = useSaveDailyRecordMutation();
  const patchMutation = usePatchDailyRecordMutation(currentDateString);
  const initMutation = useInitializeDailyRecordMutation();
  const deleteMutation = useDeleteDailyRecordMutation();
  const pendingRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const refreshRequestIdRef = useRef(0);

  const clearPendingRefetchTimeout = useCallback(() => {
    if (pendingRefetchTimeoutRef.current !== null) {
      clearTimeout(pendingRefetchTimeoutRef.current);
      pendingRefetchTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearPendingRefetchTimeout();
    };
  }, [clearPendingRefetchTimeout]);

  const bootstrapPhase = useMemo(
    (): DailyRecordBootstrapPhase =>
      resolveDailyRecordBootstrapPhase({
        remoteSyncStatus: effectiveRemoteSyncStatus,
        record,
        runtime: recordRuntime,
        gracePeriodExpired: recordRuntime?.availabilityState === 'temporarily_unavailable',
      }),
    [effectiveRemoteSyncStatus, record, recordRuntime]
  );

  useEffect(() => {
    if (bootstrapPhase !== 'record_ready' && bootstrapPhase !== 'confirmed_empty') {
      return;
    }

    markPerf('daily-record:ready', `${currentDateString}:${bootstrapPhase}`);
    flushPerfReport(`daily-record:${bootstrapPhase}`);
  }, [bootstrapPhase, currentDateString]);

  const runRemoteSync = useRemoteDailyRecordSync(dailyRecord);

  useTodayEmptyDailyRecordRecovery({
    bootstrapPhase,
    currentDateString,
    record,
    refetch,
    runRemoteSync: async date => {
      const outcome = await runRemoteSync(date);
      if (!isMountedRef.current) {
        return outcome;
      }
      return outcome;
    },
  });

  usePostDeployRecentRecordRefresh({
    remoteSyncStatus: effectiveRemoteSyncStatus,
    refetch,
    runRemoteSync: async date => {
      const outcome = await runRemoteSync(date);
      if (!isMountedRef.current) {
        return outcome;
      }
      return outcome;
    },
  });

  // 3. Status Mapping
  const syncStatus = useMemo(
    (): SyncStatus =>
      resolveMutationSyncStatus([
        {
          isPending: saveMutation.isPending,
          isError: saveMutation.isError,
          isSuccess: saveMutation.isSuccess,
        },
        {
          isPending: patchMutation.isPending,
          isError: patchMutation.isError,
          isSuccess: patchMutation.isSuccess,
        },
        {
          isPending: initMutation.isPending,
          isError: initMutation.isError,
          isSuccess: initMutation.isSuccess,
        },
        {
          isPending: deleteMutation.isPending,
          isError: deleteMutation.isError,
          isSuccess: deleteMutation.isSuccess,
        },
      ]),
    [
      deleteMutation.isError,
      deleteMutation.isPending,
      deleteMutation.isSuccess,
      initMutation.isError,
      initMutation.isPending,
      initMutation.isSuccess,
      patchMutation.isError,
      patchMutation.isPending,
      patchMutation.isSuccess,
      saveMutation.isError,
      saveMutation.isPending,
      saveMutation.isSuccess,
    ]
  );

  const lastSyncTime = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    [dataUpdatedAt]
  );

  const { error: notifyError, success, warning } = useNotification();

  const presentChannelNotice = useCallback(
    (notice: ChannelNotice | null | undefined, fallbackTitle: string) => {
      if (!notice || !notice.channel || !notice.message) {
        return;
      }

      if (notice.channel === 'error') {
        notifyError(notice.title || fallbackTitle, notice.message);
        return;
      }

      warning(notice.title || fallbackTitle, notice.message);
    },
    [notifyError, warning]
  );

  // 4. Compatibility handlers
  const saveAndUpdate = useCallback(
    async (updatedRecord: DailyRecord) => {
      try {
        const payload = await saveMutation.mutateAsync(updatedRecord);
        presentChannelNotice(resolveSaveOutcomeFeedback(payload.result), 'Guardado');
        assertDailyRecordWriteAccepted(payload.result);
      } catch (err) {
        if (err instanceof DailyRecordFreshnessGateError) {
          if (err.presentation !== 'silent') {
            warning('Censo en actualización', err.message);
          }
          throw err;
        }

        const feedback = resolveSaveErrorFeedback(err);
        if (feedback) {
          notifyError(feedback.title, feedback.message);

          if (feedback.shouldLog) {
            dailyRecordSyncLogger.error(feedback.logLabel || 'Save blocked', err);
          }

          if (feedback.refetchDelayMs) {
            clearPendingRefetchTimeout();
            pendingRefetchTimeoutRef.current = setTimeout(() => {
              refetch();
              pendingRefetchTimeoutRef.current = null;
            }, feedback.refetchDelayMs);
          }
        }
        throw err;
      }
    },
    [saveMutation, notifyError, refetch, clearPendingRefetchTimeout, presentChannelNotice, warning]
  );

  const patchRecord = useCallback(
    async (partial: DailyRecordPatch) => {
      try {
        const payload = await patchMutation.mutateAsync(partial);
        presentChannelNotice(resolvePatchOutcomeFeedback(payload.result), 'Actualización');
        assertDailyRecordWriteAccepted(payload.result);
      } catch (err) {
        if (err instanceof DailyRecordFreshnessGateError) {
          if (err.presentation !== 'silent') {
            warning('Censo en actualización', err.message);
          }
        }
        throw err;
      }
    },
    [patchMutation, presentChannelNotice, warning]
  );

  const setRecord = useCallback(
    (updater: DailyRecord | null | ((prev: DailyRecord | null) => DailyRecord | null)) => {
      const key = queryKeys.dailyRecord.byDate(currentDateString);
      setDailyRecordQueryData(queryClient, currentDateString, updater);
      queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, currentDateString]
  );

  const markLocalChange = useCallback(() => {
    // TanStack Query handles local changes via optimistic updates in mutations.
    // For ad-hoc changes not through mutations, we can manual update cache if needed.
  }, []);

  const refresh = useCallback(() => {
    const requestId = ++refreshRequestIdRef.current;

    void runRemoteSync(currentDateString)
      .then(outcome => {
        if (!isMountedRef.current || requestId !== refreshRequestIdRef.current) {
          return;
        }

        dailyRecordObservability.recordOutcome('refresh_daily_record', outcome, {
          date: currentDateString,
        });
        presentChannelNotice(presentDailyRecordRefreshOutcome(outcome), 'Sincronización');
        void refetch();
      })
      .catch(error => {
        if (!isMountedRef.current || requestId !== refreshRequestIdRef.current) {
          return;
        }

        dailyRecordObservability.recordError(
          'refresh_daily_record',
          error,
          {
            code: 'daily_record_refresh_failed',
            message: 'No fue posible completar la sincronización remota del registro del día.',
            severity: 'warning',
            userSafeMessage:
              'No fue posible completar la sincronización remota. Se mantuvo la copia local actual.',
          },
          {
            date: currentDateString,
          }
        );
        warning(
          'Sincronización',
          'No fue posible completar la sincronización remota. Se mantuvo la copia local actual.'
        );
      });
  }, [currentDateString, refetch, runRemoteSync, warning, presentChannelNotice]);

  const createDay = useCallback(
    async (copyFromPrevious: boolean, specificDate?: string) => {
      const prevDate = await resolveCreateDaySourceDate(
        dailyRecord,
        currentDateString,
        copyFromPrevious,
        specificDate,
        warning
      );
      if (prevDate === null) {
        return;
      }

      await initMutation.mutateAsync({ date: currentDateString, copyFromDate: prevDate });
      success('Día creado', buildCreateDaySuccessMessage(prevDate || undefined));
    },
    [currentDateString, initMutation, success, warning, dailyRecord]
  );

  const resetDay = useCallback(async () => {
    await deleteMutation.mutateAsync(currentDateString);
    success('Registro eliminado', 'El registro del día ha sido eliminado.');
  }, [currentDateString, deleteMutation, success]);

  return {
    record: record ?? null,
    setRecord,
    syncStatus,
    lastSyncTime,
    bootstrapPhase,
    saveAndUpdate,
    patchRecord,
    markLocalChange,
    refresh,
    createDay,
    resetDay,
  };
};
