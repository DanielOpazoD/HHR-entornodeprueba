import type { OperationalTelemetrySummary } from '@/services/observability/operationalTelemetryContracts';
import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';
import {
  buildTopObservedOperationalKey,
  isObservedOperationalTelemetryStatus,
  OBSERVED_CATEGORY_ORDER,
  OPERATIONAL_TELEMETRY_DEFAULT_WINDOW_MS,
} from '@/services/observability/operationalTelemetrySupport';

export const buildOperationalTelemetrySummary = (
  events: OperationalTelemetryEvent[],
  windowMs: number = OPERATIONAL_TELEMETRY_DEFAULT_WINDOW_MS
): OperationalTelemetrySummary => {
  const now = Date.now();
  const recentEvents = events.filter(event => now - Date.parse(event.timestamp) <= windowMs);
  const lastHourEvents = events.filter(
    event => now - Date.parse(event.timestamp) <= 60 * 60 * 1000
  );
  const observedEvents = recentEvents.filter(event =>
    isObservedOperationalTelemetryStatus(event.status)
  );
  const failedEvents = recentEvents.filter(event => event.status === 'failed');
  const observedCategoryCounts = OBSERVED_CATEGORY_ORDER.reduce<Record<string, number>>(
    (acc, category) => {
      acc[category] = recentEvents.filter(
        event => event.category === category && isObservedOperationalTelemetryStatus(event.status)
      ).length;
      return acc;
    },
    {}
  );
  const topObservedCategory = buildTopObservedOperationalKey(
    observedEvents.map(event => event.category)
  );
  const topObservedOperation = buildTopObservedOperationalKey(
    observedEvents.map(event => event.operation)
  );
  const latestObservedOperation = observedEvents.at(-1)?.operation;
  const countRuntimeState = (runtimeState: OperationalRuntimeState): number =>
    recentEvents.filter(event => event.runtimeState === runtimeState).length;
  const latestRuntimeState = [...observedEvents]
    .reverse()
    .find(event => event.runtimeState)?.runtimeState;
  const countOperation = (operation: string): number =>
    recentEvents.filter(event => event.operation === operation).length;

  return {
    recentEventCount: recentEvents.length,
    recentFailedCount: failedEvents.length,
    recentObservedCount: observedEvents.length,
    recentRetryableCount: countRuntimeState('retryable'),
    recentRecoverableCount: countRuntimeState('recoverable'),
    recentDegradedCount: countRuntimeState('degraded'),
    recentBlockedCount: countRuntimeState('blocked'),
    recentUnauthorizedCount: countRuntimeState('unauthorized'),
    lastHourObservedCount: lastHourEvents.filter(event =>
      isObservedOperationalTelemetryStatus(event.status)
    ).length,
    syncFailureCount: recentEvents.filter(
      event => event.category === 'sync' && event.status === 'failed'
    ).length,
    syncObservedCount: observedCategoryCounts.sync || 0,
    degradedLocalCount: recentEvents.filter(
      event =>
        event.category === 'indexeddb' && (event.status === 'degraded' || event.status === 'failed')
    ).length,
    indexedDbObservedCount: observedCategoryCounts.indexeddb || 0,
    clinicalDocumentObservedCount: observedCategoryCounts.clinical_document || 0,
    createDayObservedCount: observedCategoryCounts.create_day || 0,
    handoffObservedCount: observedCategoryCounts.handoff || 0,
    exportObservedCount: observedCategoryCounts.export || 0,
    backupObservedCount: observedCategoryCounts.backup || 0,
    exportOrBackupObservedCount: recentEvents.filter(
      event =>
        (event.category === 'export' || event.category === 'backup') &&
        isObservedOperationalTelemetryStatus(event.status)
    ).length,
    dailyRecordRecoveredRealtimeNullCount: countOperation('recovered_null_realtime_record'),
    // Previous producers also used this operation for blocked, unavailable reads.
    dailyRecordConfirmedRealtimeNullCount: recentEvents.filter(
      event =>
        event.operation === 'confirmed_null_realtime_record' && event.runtimeState === 'retryable'
    ).length,
    syncReadUnavailableCount:
      countOperation('sync_queue_telemetry_unavailable') +
      countOperation('sync_queue_stats_unavailable') +
      countOperation('sync_queue_recent_operations_unavailable') +
      countOperation('sync_queue_domain_metrics_unavailable'),
    indexedDbFallbackModeCount: countOperation('indexeddb_fallback_mode'),
    authBootstrapTimeoutCount: countOperation('bootstrap_timeout'),
    topObservedCategory,
    topObservedOperation,
    latestObservedOperation,
    latestRuntimeState,
    latestIssueAt: observedEvents.at(-1)?.timestamp,
  };
};
