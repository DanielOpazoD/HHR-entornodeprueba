import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  ensureDailyRecordRemoteFreshness,
  markDailyRecordRemoteConfirmed,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import {
  clearOperationalTelemetryEvents,
  getOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetryService';
import {
  parseOperationalTelemetryBody,
  shouldAlertOperationalTelemetry,
} from '@/services/observability/operationalTelemetryIngestPolicy';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

describe('dailyRecordFreshnessGate clinical input block telemetry', () => {
  const date = '2026-05-17';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    resetDailyRecordFreshnessGateForTests();
    clearOperationalTelemetryEvents();
  });

  afterEach(() => {
    resetDailyRecordFreshnessGateForTests();
    clearOperationalTelemetryEvents();
    vi.useRealTimers();
  });

  it('records clinical input block start and duration when stale resume is confirmed', () => {
    markDailyRecordTabHidden(1_000);
    markDailyRecordTabVisible(1_000 + 6 * 60 * 1_000);

    markDailyRecordRemoteConfirmed(date, {
      source: 'subscription',
      confirmedAt: 1_000 + 6 * 60 * 1_000 + 425,
    });

    expect(getOperationalTelemetryEvents()).toContainEqual(
      expect.objectContaining({
        operation: 'daily_record_clinical_inputs_block_started',
        status: 'degraded',
        context: expect.objectContaining({
          date,
          reason: 'stale_due_to_inactivity',
          resumeEpoch: 1,
        }),
      })
    );
    expect(getOperationalTelemetryEvents()).toContainEqual(
      expect.objectContaining({
        operation: 'daily_record_clinical_inputs_block_completed',
        status: 'success',
        context: expect.objectContaining({
          date,
          endedWith: 'fresh_remote_confirmed',
          blockedForMs: 425,
        }),
      })
    );
    markDailyRecordRemoteConfirmed(date, { source: 'subscription' });
    expect(
      getOperationalTelemetryEvents().filter(
        event => event.operation === 'daily_record_clinical_inputs_block_completed'
      )
    ).toHaveLength(1);
  });

  it('records the time spent reading before recovery, and keeps the safe duration through ingestion', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const record = DataFactory.createMockDailyRecord(date);
    markDailyRecordTabHidden();
    vi.advanceTimersByTime(6 * 60 * 1_000);
    markDailyRecordTabVisible();

    const check = ensureDailyRecordRemoteFreshness({
      date,
      queryClient,
      reason: 'resume',
      queryFn: () =>
        new Promise(resolve => {
          setTimeout(
            () =>
              resolve(
                createDailyRecordQueryResult(record, {
                  serverConfirmed: true,
                  date,
                  availabilityState: 'resolved',
                  consistencyState: 'remote_authoritative',
                  sourceOfTruth: 'remote',
                  retryability: 'not_applicable',
                  recoveryAction: 'none',
                  conflictSummary: null,
                  observabilityTags: [],
                  repairApplied: false,
                })
              ),
            750
          );
        }),
    });
    await vi.advanceTimersByTimeAsync(750);
    await check;

    const completion = getOperationalTelemetryEvents().find(
      event => event.operation === 'daily_record_clinical_inputs_block_completed'
    );
    expect(completion).toMatchObject({ status: 'success', context: { blockedForMs: 750 } });
    const received = parseOperationalTelemetryBody(
      JSON.stringify({
        source: 'hhr_operational_telemetry',
        event: sanitizeOperationalTelemetryEvent(completion ?? {}),
      })
    );
    expect(received).toMatchObject({ ok: true, event: { context: { blockedForMs: 750 } } });
    if (!received.ok) throw new Error('Recovery telemetry was rejected');
    expect(shouldAlertOperationalTelemetry(received.event)).toBe(false);
    queryClient.clear();
  });

  it('records clinical input block failure duration when the latest data cannot be confirmed', async () => {
    const queryClient = new QueryClient();
    const record = DataFactory.createMockDailyRecord(date);

    markDailyRecordTabHidden(5_000);
    markDailyRecordTabVisible(5_000 + 6 * 60 * 1_000);

    await expect(
      ensureDailyRecordRemoteFreshness({
        date,
        queryClient,
        reason: 'clinical_patch',
        now: 5_000 + 6 * 60 * 1_000 + 100,
        queryFn: () =>
          Promise.resolve(
            createDailyRecordQueryResult(record, {
              serverConfirmed: false,
              date,
              availabilityState: 'temporarily_unavailable',
              consistencyState: 'unavailable',
              sourceOfTruth: 'none',
              retryability: 'automatic_retry',
              recoveryAction: 'defer_remote_sync',
              conflictSummary: {
                kind: 'remote_unavailable',
                sourceOfTruth: 'local',
                localTimestamp: record.lastUpdated,
                message: 'Firebase no disponible',
              },
              observabilityTags: ['daily_record', 'read', 'remote_unavailable'],
              repairApplied: false,
            })
          ),
      })
    ).rejects.toThrow('Estamos verificando los últimos datos');

    expect(getOperationalTelemetryEvents()).toContainEqual(
      expect.objectContaining({
        operation: 'daily_record_clinical_inputs_block_failed',
        status: 'degraded',
        context: expect.objectContaining({
          date,
          reason: 'clinical_patch',
          blockedForMs: expect.any(Number),
        }),
      })
    );
  });
});
