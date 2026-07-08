import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordSyncPort } from '@/application/ports/dailyRecordPort';
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

let syncDailyRecordUseCasePromise: Promise<
  typeof import('@/application/daily-record/syncDailyRecordUseCase')
> | null = null;

const loadSyncDailyRecordUseCase = async () => {
  syncDailyRecordUseCasePromise ??= import('@/application/daily-record/syncDailyRecordUseCase');
  return syncDailyRecordUseCasePromise;
};

type BrowserWindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export const useDeferredRemoteHydration = (
  currentDateString: string,
  remoteSyncStatus: RemoteSyncRuntimeStatus
): RemoteSyncRuntimeStatus => {
  const [remoteHydrationReadyDate, setRemoteHydrationReadyDate] = useState<string | null>(null);
  const readySignature = remoteSyncStatus === 'ready' ? currentDateString : null;
  const shouldDeferRemoteHydration =
    readySignature !== null && remoteHydrationReadyDate !== currentDateString;

  useEffect(() => {
    if (readySignature === null) {
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
  }, [currentDateString, readySignature]);

  return shouldDeferRemoteHydration ? 'local_only' : remoteSyncStatus;
};

export const useRemoteDailyRecordSync = (dailyRecord: DailyRecordSyncPort) =>
  useCallback(
    async (date: string) => {
      const { executeSyncDailyRecord } = await loadSyncDailyRecordUseCase();
      return executeSyncDailyRecord({
        date,
        repository: dailyRecord,
      });
    },
    [dailyRecord]
  );

interface UseTodayEmptyDailyRecordRecoveryParams {
  bootstrapPhase: DailyRecordBootstrapPhase;
  currentDateString: string;
  record: DailyRecord | null;
  refetch: () => Promise<unknown>;
  runRemoteSync: (date: string) => Promise<OperationalOutcomeLike>;
}

export const useTodayEmptyDailyRecordRecovery = ({
  bootstrapPhase,
  currentDateString,
  record,
  refetch,
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

    let cancelled = false;

    void runRemoteSync(currentDateString)
      .then(outcome => {
        if (cancelled) {
          return;
        }

        dailyRecordObservability.recordOutcome('recover_today_empty_daily_record', outcome, {
          date: currentDateString,
          context: {
            source: 'useDailyRecordSyncQuery',
          },
        });
        void refetch();
      })
      .catch(error => {
        if (cancelled) {
          return;
        }

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

    return () => {
      cancelled = true;
    };
  }, [bootstrapPhase, currentDateString, record, refetch, runRemoteSync]);
};

interface UsePostDeployRecentRecordRefreshParams {
  remoteSyncStatus: RemoteSyncRuntimeStatus;
  refetch: () => Promise<unknown>;
  runRemoteSync: (date: string) => Promise<OperationalOutcomeLike>;
}

export const usePostDeployRecentRecordRefresh = ({
  remoteSyncStatus,
  refetch,
  runRemoteSync,
}: UsePostDeployRecentRecordRefreshParams) => {
  const attemptedMarkerSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (remoteSyncStatus !== 'ready') {
      return;
    }

    const marker = readPostDeployRecentRecordRefreshMarker();
    if (!marker) {
      return;
    }

    const markerSignature = `${marker.fromVersion}->${marker.toVersion}:${marker.createdAt}`;
    if (attemptedMarkerSignatureRef.current === markerSignature) {
      return;
    }

    attemptedMarkerSignatureRef.current = markerSignature;
    let cancelled = false;

    void executePostDeployRecentRecordRefresh({
      readMarker: () => marker,
      syncRemoteRecord: runRemoteSync,
    }).then(result => {
      if (cancelled || result.status !== 'completed') {
        return;
      }

      void refetch();
    });

    return () => {
      cancelled = true;
    };
  }, [refetch, remoteSyncStatus, runRemoteSync]);
};
