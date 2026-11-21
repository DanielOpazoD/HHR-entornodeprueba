import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordReadPort } from '@/application/ports/dailyRecordPort';
import { fetchRemoteDailyRecordQuery } from '@/hooks/controllers/dailyRecordQueryController';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import { shouldAttemptTodayEmptyRecovery } from '@/hooks/controllers/dailyRecordBootstrapController';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import type { OperationalOutcomeLike } from '@/services/observability/operationalTelemetryContracts';
import { getTodayISO } from '@/utils/dateCoreUtils';
import {
  executePostDeployRecentRecordRefresh,
  readPostDeployRecentRecordRefreshMarker,
} from '@/services/config/postDeployRecentRecordRefresh';

const REMOTE_HYDRATION_IDLE_TIMEOUT_MS = 1_200;
const REMOTE_HYDRATION_FALLBACK_DELAY_MS = 150;

const loadSyncDailyRecordUseCase = createCachedRuntimeLoader(
  () => import('@/application/daily-record/syncDailyRecordUseCase')
);

type BrowserWindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export const useDeferredRemoteHydration = (
  currentDateString: string,
  remoteSyncStatus: RemoteSyncRuntimeStatus
): RemoteSyncRuntimeStatus => {
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<DailyRecordQueryResult>(
    queryKeys.dailyRecord.byDate(currentDateString)
  );
  // Idle scheduling only helps when there is local data to paint. A settled
  // local miss needs its remote answer immediately, not another idle window.
  const needsRemoteAnswer = cached?.record === null;
  const [remoteHydrationReadyDate, setRemoteHydrationReadyDate] = useState<string | null>(null);
  const readySignature = remoteSyncStatus === 'ready' ? currentDateString : null;
  const shouldDeferRemoteHydration =
    readySignature !== null && !needsRemoteAnswer && remoteHydrationReadyDate !== currentDateString;

  useEffect(() => {
    if (readySignature === null || needsRemoteAnswer) {
      return;
    }

    let timeoutId: number | null = null;
    let idleCallbackId: number | null = null;
    let cancelled = false;

    const enableRemoteHydration = () => {
      if (!cancelled) {
        setRemoteHydrationReadyDate(currentDateString);
      }
    };

    const browserWindow =
      typeof window !== 'undefined' ? (window as BrowserWindowWithIdleCallback) : null;

    if (browserWindow?.requestIdleCallback) {
      idleCallbackId = browserWindow.requestIdleCallback(enableRemoteHydration, {
        timeout: REMOTE_HYDRATION_IDLE_TIMEOUT_MS,
      });
    } else {
      timeoutId = window.setTimeout(enableRemoteHydration, REMOTE_HYDRATION_FALLBACK_DELAY_MS);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleCallbackId !== null && browserWindow?.cancelIdleCallback) {
        browserWindow.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [currentDateString, readySignature, needsRemoteAnswer]);

  return shouldDeferRemoteHydration ? 'local_only' : remoteSyncStatus;
};

/** Reads one day from the server once, through its query, and says how the read went. */
export const useRemoteDailyRecordSync = (
  dailyRecord: Pick<DailyRecordReadPort, 'getForDateWithMeta'>
) => {
  const queryClient = useQueryClient();
  return useCallback(
    async (date: string) => {
      const { executeSyncDailyRecord } = await loadSyncDailyRecordUseCase();
      return executeSyncDailyRecord({
        date,
        read: readDate => fetchRemoteDailyRecordQuery(queryClient, dailyRecord, readDate),
      });
    },
    [dailyRecord, queryClient]
  );
};

interface UseTodayEmptyDailyRecordRecoveryParams {
  bootstrapPhase: DailyRecordBootstrapPhase;
  isFetching?: boolean;
  currentDateString: string;
  record: DailyRecord | null;
  runRemoteSync: (date: string) => Promise<OperationalOutcomeLike>;
}

export const useTodayEmptyDailyRecordRecovery = ({
  bootstrapPhase,
  isFetching = false,
  currentDateString,
  record,
  runRemoteSync,
}: UseTodayEmptyDailyRecordRecoveryParams) => {
  const todayNullRecoveryAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (record) {
      if (todayNullRecoveryAttemptedRef.current === currentDateString) {
        todayNullRecoveryAttemptedRef.current = null;
      }
      return;
    }

    // The primary read already owns this answer. Starting recovery here used
    // to duplicate the request and trigger another refetch before showing Moa.
    if (isFetching) return;
    const todayDateString = getTodayISO();

    if (
      !shouldAttemptTodayEmptyRecovery({
        currentDateString,
        todayDateString,
        bootstrapPhase,
      })
    ) {
      return;
    }

    if (todayNullRecoveryAttemptedRef.current === currentDateString) {
      return;
    }

    todayNullRecoveryAttemptedRef.current = currentDateString;

    // The read publishes the day through its query, so the census needs no second read. Its
    // outcome is recorded even after the day appears, which re-runs this effect.
    void runRemoteSync(currentDateString)
      .then(outcome => {
        dailyRecordObservability.recordOutcome('recover_today_empty_daily_record', outcome, {
          date: currentDateString,
          context: {
            source: 'useDailyRecordSyncQuery',
          },
        });
      })
      .catch(error => {
        dailyRecordObservability.recordError(
          'recover_today_empty_daily_record',
          error,
          {
            code: 'daily_record_today_empty_recovery_failed',
            message: 'No fue posible recuperar el registro del día desde la ruta remota diferida.',
            severity: 'warning',
            userSafeMessage:
              'Se mantuvo la copia local mientras se reintenta la recuperación remota del día.',
          },
          {
            date: currentDateString,
            context: {
              source: 'useDailyRecordSyncQuery',
            },
          }
        );
      });
  }, [bootstrapPhase, isFetching, currentDateString, record, runRemoteSync]);
};

interface UsePostDeployRecentRecordRefreshParams {
  remoteSyncStatus: RemoteSyncRuntimeStatus;
  runRemoteSync: (date: string) => Promise<OperationalOutcomeLike>;
}

export const usePostDeployRecentRecordRefresh = ({
  remoteSyncStatus,
  runRemoteSync,
}: UsePostDeployRecentRecordRefreshParams) => {
  const sessionEpoch = useSessionEpoch();
  const attemptedMarkerSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (remoteSyncStatus !== 'ready') {
      return;
    }

    const marker = readPostDeployRecentRecordRefreshMarker();
    if (!marker) {
      return;
    }

    const markerSignature = `${sessionEpoch}:${marker.fromVersion}->${marker.toVersion}:${marker.createdAt}`;
    if (attemptedMarkerSignatureRef.current === markerSignature) {
      return;
    }

    attemptedMarkerSignatureRef.current = markerSignature;
    // Each day is read once through its query, so the census shows it without another read.
    void executePostDeployRecentRecordRefresh({
      readMarker: () => marker,
      syncRemoteRecord: runRemoteSync,
    }).then(result => {
      if (
        result.status !== 'completed' &&
        attemptedMarkerSignatureRef.current === markerSignature
      ) {
        attemptedMarkerSignatureRef.current = null;
      }
    });
  }, [remoteSyncStatus, runRemoteSync, sessionEpoch]);
};
