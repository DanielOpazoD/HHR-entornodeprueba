import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useVersion } from '@/context/VersionContext';
import { useIsMutating } from '@tanstack/react-query';
import { fetchErrorLogs } from '@/services/errorLogService';
import type { UserHealthStatus } from '@/services/admin/healthService';
import { getLocalPersistenceRuntimeSnapshot } from '@/services/storage/indexeddb/indexedDbCore';
import { getSyncQueueTelemetry, listRecentSyncQueueOperations } from '@/services/storage/sync';
import { getRepositoryPerformanceSummary } from '@/services/repositories/repositoryPerformance';
import {
  getOperationalTelemetryEvents,
  getOperationalTelemetrySummary,
} from '@/services/observability/operationalTelemetryRecorder';
import { buildClientOperationalRuntimeSnapshot } from '@/services/observability/clientOperationalRuntimeSnapshot';
import { buildAuthRuntimeSnapshot } from '@/services/auth/authRuntimeSnapshot';
import {
  buildRecentUserHealthEvents,
  buildUserHealthStatus,
  canReportSystemHealthForRuntime,
} from '@/hooks/controllers/systemHealthReporterController';
import { systemHealthReporterLogger } from '@/hooks/hookLoggers';

const REPORT_INTERVAL_MS = 2 * 60 * 1000; // Report every 2 minutes
let healthServiceModulePromise: Promise<typeof import('@/services/admin/healthService')> | null =
  null;

const loadHealthService = async () => {
  healthServiceModulePromise ??= import('@/services/admin/healthService');
  return healthServiceModulePromise;
};

/**
 * Hook that periodically reports the system health status to Firestore.
 * Runs in the background and only reports if a user is logged in.
 */
export const useSystemHealthReporter = (enabled = true) => {
  const auth = useAuth();
  const { currentUser, role } = auth;
  const { isOutdated, updateReason } = useVersion();
  const mutatingCount = useIsMutating();
  const lastReportTime = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !currentUser || !canReportSystemHealthForRuntime(role, auth.remoteSyncStatus)) {
      return;
    }

    const reportHealth = async () => {
      try {
        // Get error count from IndexedDB
        const logs = await fetchErrorLogs(100);
        const localErrorCount = logs.length;
        const [syncTelemetry, recentSyncOperations] = await Promise.all([
          getSyncQueueTelemetry(),
          listRecentSyncQueueOperations(8),
        ]);
        const pendingSyncTasks = syncTelemetry.pending;
        const failedSyncTasks = syncTelemetry.failed;
        const conflictSyncTasks = syncTelemetry.conflict;
        const retryingSyncTasks = syncTelemetry.retrying;
        const oldestPendingAgeMs = syncTelemetry.oldestPendingAgeMs;
        const syncBatchSize = syncTelemetry.batchSize;
        const repositoryPerformance = getRepositoryPerformanceSummary();
        const operationalEvents = getOperationalTelemetryEvents();
        const operationalTelemetry = getOperationalTelemetrySummary();
        const localPersistence = getLocalPersistenceRuntimeSnapshot();
        const authRuntime =
          auth.authRuntime ||
          buildAuthRuntimeSnapshot({
            sessionState: auth.sessionState,
            authLoading: auth.isLoading,
            isFirebaseConnected: auth.isFirebaseConnected,
            isOnline: navigator.onLine,
          });
        const runtimeSnapshot = buildClientOperationalRuntimeSnapshot({
          auth: authRuntime,
          localPersistence,
          sync: syncTelemetry,
        });

        const status: UserHealthStatus = buildUserHealthStatus({
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          isFirebaseConnected: authRuntime.isFirebaseConnected,
          isOutdated: !!isOutdated,
          remoteSyncReason: auth.remoteSyncState.reason,
          versionUpdateReason: updateReason,
          mutatingCount,
          localErrorCount,
          degradedLocalPersistence: runtimeSnapshot.degradedLocalPersistence,
          navigatorOnline: navigator.onLine,
          platform: navigator.platform,
          userAgent: navigator.userAgent,
          syncTelemetry: {
            pending: pendingSyncTasks,
            failed: failedSyncTasks,
            conflict: conflictSyncTasks,
            retrying: retryingSyncTasks,
            orphanedTasks: syncTelemetry.orphanedTasks || 0,
            oldestPendingAgeMs,
            batchSize: syncBatchSize,
            oldestPendingBudgetState: syncTelemetry.oldestPendingBudgetState,
            retryingBudgetState: syncTelemetry.retryingBudgetState,
            runtimeState: syncTelemetry.runtimeState,
          },
          repositoryPerformance,
          operationalTelemetry,
          recentEvents: buildRecentUserHealthEvents({
            localErrors: logs,
            operationalEvents,
            recentSyncOperations,
          }),
        });

        const { reportUserHealth } = await loadHealthService();
        await reportUserHealth(status);
        lastReportTime.current = Date.now();
      } catch (error) {
        systemHealthReporterLogger.error('Failed to report status', error);
      }
    };

    // Immediate report on mount or when critical stats change
    reportHealth();

    // Setup interval for periodic reporting
    const interval = setInterval(() => {
      // Only report if enough time has passed (throttle)
      if (Date.now() - lastReportTime.current >= REPORT_INTERVAL_MS - 5000) {
        reportHealth();
      }
    }, REPORT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [auth, currentUser, enabled, role, isOutdated, mutatingCount, updateReason]);
};
