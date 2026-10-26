import { useCensusBootstrapPerf, useCensusRecordPerf } from '@/hooks/useCensusRecordPerf';

import { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  useDailyRecordQuery,
  useSaveDailyRecordMutation,
  usePatchDailyRecordMutation,
} from './useDailyRecordQuery';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../config/queryClient';
import { UseDailyRecordSyncResult } from '@/context/dailyRecordContextContracts';
import type {
  ApplyDailyRecordPatchOptions,
  DailyRecord,
  DailyRecordPatch,
} from '@/application/shared/dailyRecordCoreContracts';
import { useRepositories } from '@/services/RepositoryContext';
import { useNotification } from '@/context/UIContext';
import { useVersion } from '@/context/VersionContext';
import {
  presentSyncOutcomeFeedback,
  resolvePatchOutcomeFeedback,
  resolvePatchErrorFeedback,
  resolveSaveErrorFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import {
  assertDailyRecordWriteAccepted,
  DailyRecordWriteBlockedOutcomeError,
} from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';
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
    isFetching: isRecordFetching,
    isError: isRecordError,
    fetchStatus: recordFetchStatus,
    refetch,
  } = useDailyRecordQuery(
    currentDateString,
    _isOfflineMode,
    effectiveRemoteSyncStatus,
    remoteSyncStatus
  );

  useCensusRecordPerf(currentDateString, record?.date, recordRuntime?.sourceOfTruth);

  // Monitor version in incoming records
  useEffect(() => {
    if (record?.schemaVersion) {
      checkVersion(record.schemaVersion);
    }
  }, [record, checkVersion]);

  // 2. Mutations
  const saveMutation = useSaveDailyRecordMutation();
  const patchMutation = usePatchDailyRecordMutation(currentDateString);
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

  const isRecordPending = isRecordFetching || recordFetchStatus === 'paused';
  const bootstrapPhase: DailyRecordBootstrapPhase = resolveDailyRecordBootstrapPhase({
    remoteSyncStatus: effectiveRemoteSyncStatus,
    currentDateString,
    isError: isRecordError,
    isFetching: isRecordPending,
    record,
    runtime: recordRuntime,
    gracePeriodExpired: recordRuntime?.availabilityState === 'temporarily_unavailable',
  });

  useCensusBootstrapPerf(currentDateString, bootstrapPhase);

  const runRemoteSync = useRemoteDailyRecordSync(dailyRecord);

  useTodayEmptyDailyRecordRecovery({
    bootstrapPhase,
    isFetching: isRecordPending,
    currentDateString,
    record,
    refetch,
    runRemoteSync,
  });

  usePostDeployRecentRecordRefresh({
    remoteSyncStatus: effectiveRemoteSyncStatus,
    refetch,
    runRemoteSync,
  });

  // 3. Status Mapping
  const syncStatus = resolveDailyRecordSyncStatus([saveMutation, patchMutation]);

  const lastSyncTime = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    [dataUpdatedAt]
  );

  const { error: notifyError, success, warning } = useNotification();

  // 4. Compatibility handlers
  const saveAndUpdate = useCallback(
    async (updatedRecord: DailyRecord, baseRecord?: DailyRecord) => {
      try {
        const payload = await saveMutation.mutateAsync({
          record: updatedRecord,
          baseRecord,
          expectedLastUpdated: baseRecord?.lastUpdated,
        });
        presentSyncOutcomeFeedback(resolveSaveOutcomeFeedback(payload.result), 'Guardado', {
          error: notifyError,
          success,
          warning,
        });
        assertDailyRecordWriteAccepted(payload.result);
      } catch (err) {
        if (err instanceof DailyRecordFreshnessGateError) {
          if (err.presentation !== 'silent') {
            warning('Censo en actualización', err.message);
          }
          throw err;
        }

        if (err instanceof DailyRecordWriteBlockedOutcomeError) {
          throw err;
        }

        const feedback = resolveSaveErrorFeedback(err);
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
        throw err;
      }
    },
    [saveMutation, notifyError, success, refetch, clearPendingRefetchTimeout, warning]
  );

  const patchRecord = useCallback(
    async (partial: DailyRecordPatch, options?: ApplyDailyRecordPatchOptions) => {
      try {
        const payload = await patchMutation.mutateAsync(
          options?.consistency === 'remote_confirmed' ||
            options?.intentionalBedClear ||
            options?.specialtyIntent
            ? {
                partial,
                options: {
                  requireConfirmedRecord: true,
                  requireRemoteAuthorityFirst: true,
                  ...(options.requireAtomicCas ||
                  (options.optimisticRemoteConfirmed && !options.intentionalBedClear)
                    ? { requireAtomicCas: true }
                    : {}),
                  ...(options.optimisticRemoteConfirmed ? { optimisticRemoteConfirmed: true } : {}),
                  ...(options.clinicalCribCreate
                    ? { clinicalCribCreate: options.clinicalCribCreate }
                    : {}),
                  ...(options.intentionalBedClear
                    ? { intentionalBedClear: options.intentionalBedClear }
                    : {}),
                  ...(options.specialtyIntent ? { specialtyIntent: options.specialtyIntent } : {}),
                },
              }
            : options?.specialistHandoffTargets
              ? { partial, options: { specialistHandoffTargets: options.specialistHandoffTargets } }
              : partial
        );
        presentSyncOutcomeFeedback(resolvePatchOutcomeFeedback(payload.result), 'Actualización', {
          error: notifyError,
          success,
          warning,
        });
        assertDailyRecordWriteAccepted(payload.result);
      } catch (err) {
        if (err instanceof DailyRecordFreshnessGateError) {
          if (err.presentation !== 'silent') {
            warning('Censo en actualización', err.message);
          }
          throw err;
        }

        if (err instanceof DailyRecordWriteBlockedOutcomeError) {
          throw err;
        }

        const feedback = resolvePatchErrorFeedback(err);
        notifyError(feedback.title, feedback.message);
        if (feedback.shouldLog) {
          dailyRecordSyncLogger.error(feedback.logLabel || 'Patch failed', err);
        }
        throw err;
      }
    },
    [patchMutation, notifyError, success, warning]
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
        presentSyncOutcomeFeedback(presentDailyRecordRefreshOutcome(outcome), 'Sincronización', {
          error: notifyError,
          success,
          warning,
        });
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
  }, [currentDateString, notifyError, refetch, runRemoteSync, success, warning]);

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
  };
};
