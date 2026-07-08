import { useCallback, useEffect, useRef, useState } from 'react';
import { getSyncQueueTelemetry, listRecentSyncQueueOperations } from '@/services/storage/sync';
import { syncQueueMonitorLogger } from '@/hooks/hookLoggers';
import {
  buildSyncQueueStats,
  buildUnavailableSyncQueueStats,
  EMPTY_SYNC_QUEUE_STATS,
  hasSyncQueueIssues,
  type SyncQueueOperation,
  type SyncQueueStats,
} from '@/hooks/controllers/syncQueueMonitorController';

export const SYNC_QUEUE_POLL_INTERVAL_MS = 4000;

interface UseSyncQueueMonitorOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
  operationLimit?: number;
}

export type { SyncQueueOperation, SyncQueueStats };

export const useSyncQueueMonitor = (
  options: UseSyncQueueMonitorOptions = {}
): {
  stats: SyncQueueStats;
  operations: SyncQueueOperation[];
  hasQueueIssues: boolean;
  refresh: () => Promise<void>;
} => {
  const {
    enabled = true,
    pollIntervalMs = SYNC_QUEUE_POLL_INTERVAL_MS,
    operationLimit = 5,
  } = options;
  const [stats, setStats] = useState<SyncQueueStats>(EMPTY_SYNC_QUEUE_STATS);
  const [operations, setOperations] = useState<SyncQueueOperation[]>([]);
  const isMountedRef = useRef(true);
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;

    try {
      const [telemetryResult, operationsResult] = await Promise.allSettled([
        getSyncQueueTelemetry(),
        listRecentSyncQueueOperations(operationLimit),
      ]);

      if (!isMountedRef.current || requestId !== refreshRequestIdRef.current) {
        return;
      }

      const recentOperationsReadState =
        operationsResult.status === 'fulfilled' ? 'ok' : 'unavailable';

      if (telemetryResult.status === 'rejected') {
        syncQueueMonitorLogger.warn('Failed to refresh queue telemetry', telemetryResult.reason);
      }

      if (operationsResult.status === 'rejected') {
        syncQueueMonitorLogger.warn(
          'Failed to refresh recent queue operations',
          operationsResult.reason
        );
      }

      setStats(
        telemetryResult.status === 'fulfilled'
          ? buildSyncQueueStats(telemetryResult.value, recentOperationsReadState)
          : buildUnavailableSyncQueueStats(recentOperationsReadState)
      );
      setOperations(operationsResult.status === 'fulfilled' ? operationsResult.value : []);
    } catch (error) {
      if (!isMountedRef.current || requestId !== refreshRequestIdRef.current) {
        return;
      }

      syncQueueMonitorLogger.warn('Failed to refresh queue monitor', error);
    }
  }, [operationLimit]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;

    const run = async () => {
      if (!active) return;
      await refresh();
    };

    void run();
    const intervalId = setInterval(() => {
      void run();
    }, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [enabled, pollIntervalMs, refresh]);

  const hasQueueIssues = hasSyncQueueIssues(stats);

  return { stats, operations, hasQueueIssues, refresh };
};
