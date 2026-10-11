import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOperationalTelemetrySummary,
  clearOperationalTelemetryEvents,
  getOperationalTelemetryEvents,
  recordOperationalErrorTelemetry,
  recordOperationalOutcome,
  recordOperationalTelemetry,
} from '@/services/observability/operationalTelemetryService';

describe('operationalTelemetryService', () => {
  beforeEach(() => {
    clearOperationalTelemetryEvents();
    vi.useRealTimers();
  });

  it('records failed and degraded operations with sanitized issues and context', () => {
    recordOperationalTelemetry({
      category: 'sync',
      status: 'failed',
      operation: 'refresh_daily_record',
      issues: ['  Error de sync  ', '', 'Sin red'],
      context: { date: '2026-03-06', count: 2, nested: { retry: true } },
    });

    const events = getOperationalTelemetryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.issues).toEqual(['Error de sync', 'Sin red']);
    expect(events[0]?.context).toEqual({
      date: '2026-03-06',
      count: 2,
      nested: JSON.stringify({ retry: true }),
    });
  });

  it('does not store success events unless allowSuccess is enabled', () => {
    recordOperationalTelemetry({
      category: 'export',
      status: 'success',
      operation: 'export_pdf',
    });

    expect(getOperationalTelemetryEvents()).toHaveLength(0);

    recordOperationalOutcome(
      'export',
      'export_pdf',
      { status: 'success', issues: [] },
      { allowSuccess: true }
    );

    expect(getOperationalTelemetryEvents()).toHaveLength(1);
  });

  it('builds recent summary counts for sync, indexeddb and export/backup observations', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T20:00:00.000Z'));

    recordOperationalTelemetry({
      category: 'sync',
      status: 'failed',
      runtimeState: 'blocked',
      operation: 'sync_daily_record',
    });
    recordOperationalTelemetry({
      category: 'indexeddb',
      status: 'degraded',
      runtimeState: 'degraded',
      operation: 'repair_indexeddb',
    });
    recordOperationalTelemetry({
      category: 'backup',
      status: 'partial',
      runtimeState: 'recoverable',
      operation: 'backup_handoff_pdf',
    });
    recordOperationalTelemetry({
      category: 'clinical_document',
      status: 'degraded',
      runtimeState: 'retryable',
      operation: 'export_clinical_document_pdf',
    });
    recordOperationalTelemetry({
      category: 'create_day',
      status: 'failed',
      runtimeState: 'unauthorized',
      operation: 'copy_previous_day',
    });

    const summary = buildOperationalTelemetrySummary(getOperationalTelemetryEvents());
    expect(summary.recentObservedCount).toBe(5);
    expect(summary.recentFailedCount).toBe(2);
    expect(summary.recentRetryableCount).toBe(1);
    expect(summary.recentRecoverableCount).toBe(1);
    expect(summary.recentDegradedCount).toBe(1);
    expect(summary.recentBlockedCount).toBe(1);
    expect(summary.recentUnauthorizedCount).toBe(1);
    expect(summary.lastHourObservedCount).toBe(5);
    expect(summary.syncFailureCount).toBe(1);
    expect(summary.syncObservedCount).toBe(1);
    expect(summary.degradedLocalCount).toBe(1);
    expect(summary.indexedDbObservedCount).toBe(1);
    expect(summary.clinicalDocumentObservedCount).toBe(1);
    expect(summary.createDayObservedCount).toBe(1);
    expect(summary.handoffObservedCount).toBe(0);
    expect(summary.backupObservedCount).toBe(1);
    expect(summary.exportOrBackupObservedCount).toBe(1);
    expect(summary.dailyRecordRecoveredRealtimeNullCount).toBe(0);
    expect(summary.syncReadUnavailableCount).toBe(0);
    expect(summary.indexedDbFallbackModeCount).toBe(0);
    expect(summary.authBootstrapTimeoutCount).toBe(0);
    expect(summary.latestRuntimeState).toBe('unauthorized');
    expect(summary.latestIssueAt).toBeDefined();
  });

  it('tracks handoff observations separately from export and backup', () => {
    recordOperationalTelemetry({
      category: 'handoff',
      status: 'degraded',
      runtimeState: 'recoverable',
      operation: 'send_medical_handoff',
    });

    const summary = buildOperationalTelemetrySummary(getOperationalTelemetryEvents());
    expect(summary.handoffObservedCount).toBe(1);
    expect(summary.topObservedCategory).toBe('handoff');
    expect(summary.topObservedOperation).toBe('send_medical_handoff');
    expect(summary.latestRuntimeState).toBe('recoverable');
  });

  it('filters malformed persisted events and sanitizes persisted issues/context', () => {
    window.localStorage.setItem(
      'operationalTelemetryEvents',
      JSON.stringify([
        {
          category: 'sync',
          status: 'failed',
          runtimeState: 'blocked',
          operation: 'sync_daily_record',
          timestamp: '2026-03-06T20:00:00.000Z',
          issues: [' Error ', '', 1],
          context: { attempt: 3, nested: { reason: 'timeout' }, ignored: undefined },
        },
        {
          category: 'sync',
          status: 'unknown',
          operation: 'broken_event',
          timestamp: '2026-03-06T20:00:00.000Z',
        },
        {
          category: 'sync',
          status: 'failed',
          operation: '',
          timestamp: 'invalid-date',
        },
      ])
    );

    const events = getOperationalTelemetryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      category: 'sync',
      status: 'failed',
      runtimeState: 'blocked',
      operation: 'sync_daily_record',
      timestamp: '2026-03-06T20:00:00.000Z',
      issues: ['Error', '1'],
      context: { attempt: 3, nested: JSON.stringify({ reason: 'timeout' }) },
    });
  });

  it('does not count success statuses as observed in hourly and export/backup metrics', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T20:00:00.000Z'));

    recordOperationalTelemetry(
      {
        category: 'export',
        status: 'success',
        operation: 'export_pdf',
      },
      { allowSuccess: true }
    );
    recordOperationalTelemetry({
      category: 'backup',
      status: 'partial',
      operation: 'backup_handoff_pdf',
    });

    const summary = buildOperationalTelemetrySummary(getOperationalTelemetryEvents());
    expect(summary.lastHourObservedCount).toBe(1);
    expect(summary.exportOrBackupObservedCount).toBe(1);
  });

  it('records structured operational errors with code and safe message in context', () => {
    recordOperationalErrorTelemetry(
      'transfers',
      'subscribe_transfers_active',
      new Error('socket down'),
      {
        code: 'transfer_active_subscription_failed',
        message: 'socket down',
        severity: 'warning',
        runtimeState: 'retryable',
        userSafeMessage: 'No se pudo sincronizar traslados activos.',
      }
    );

    const event = getOperationalTelemetryEvents()[0];
    expect(event?.issues).toEqual(['No se pudo sincronizar traslados activos.']);
    expect(event?.context).toEqual(
      expect.objectContaining({ errorCode: 'transfer_active_subscription_failed' })
    );
    expect(event?.status).toBe('degraded');
    expect(event?.runtimeState).toBe('retryable');
  });

  it('counts incident-level operations used by support/admin dashboards', () => {
    recordOperationalTelemetry({
      category: 'daily_record',
      status: 'degraded',
      runtimeState: 'recoverable',
      operation: 'recovered_null_realtime_record',
    });
    recordOperationalTelemetry({
      category: 'daily_record',
      status: 'degraded',
      runtimeState: 'retryable',
      operation: 'confirmed_null_realtime_record',
    });
    recordOperationalTelemetry({
      category: 'sync',
      status: 'failed',
      runtimeState: 'blocked',
      operation: 'sync_queue_telemetry_unavailable',
    });
    recordOperationalTelemetry({
      category: 'indexeddb',
      status: 'degraded',
      runtimeState: 'recoverable',
      operation: 'indexeddb_fallback_mode',
    });
    recordOperationalTelemetry({
      category: 'auth',
      status: 'degraded',
      runtimeState: 'recoverable',
      operation: 'bootstrap_timeout',
    });

    // Old producers used the confirmed operation even when reading was blocked.
    recordOperationalTelemetry({
      category: 'daily_record',
      status: 'degraded',
      runtimeState: 'blocked',
      operation: 'confirmed_null_realtime_record',
    });
    recordOperationalTelemetry({
      category: 'daily_record',
      status: 'degraded',
      runtimeState: 'blocked',
      operation: 'unavailable_null_realtime_record',
    });
    expect(getOperationalTelemetryEvents().at(-1)?.operation).toBe(
      'unavailable_null_realtime_record'
    );
    const summary = buildOperationalTelemetrySummary(getOperationalTelemetryEvents());
    expect(summary.recentBlockedCount).toBe(3);
    expect(summary.dailyRecordRecoveredRealtimeNullCount).toBe(1);
    expect(summary.dailyRecordConfirmedRealtimeNullCount).toBe(1);
    expect(summary.syncReadUnavailableCount).toBe(1);
    expect(summary.indexedDbFallbackModeCount).toBe(1);
    expect(summary.authBootstrapTimeoutCount).toBe(1);
  });
});
