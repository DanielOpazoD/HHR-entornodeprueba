import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  ensureDailyRecordRemoteFreshness,
  markDailyRecordRemoteConfirmed,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';

const { mockRecordEvent, mockRecordError } = vi.hoisted(() => ({
  mockRecordEvent: vi.fn(),
  mockRecordError: vi.fn(),
}));

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: mockRecordEvent,
    recordError: mockRecordError,
  },
}));

describe('dailyRecordFreshnessGate clinical input block telemetry', () => {
  const date = '2026-05-17';

  beforeEach(() => {
    resetDailyRecordFreshnessGateForTests();
    mockRecordEvent.mockClear();
    mockRecordError.mockClear();
  });

  it('records clinical input block start and duration when stale resume is confirmed', () => {
    markDailyRecordTabHidden(1_000);
    markDailyRecordTabVisible(1_000 + 6 * 60 * 1_000);

    markDailyRecordRemoteConfirmed(date, {
      source: 'subscription',
      confirmedAt: 1_000 + 6 * 60 * 1_000 + 425,
    });

    expect(mockRecordEvent).toHaveBeenCalledWith(
      'daily_record_clinical_inputs_block_started',
      'degraded',
      expect.objectContaining({
        context: expect.objectContaining({
          date,
          reason: 'stale_due_to_inactivity',
          resumeEpoch: 1,
        }),
      })
    );
    expect(mockRecordEvent).toHaveBeenCalledWith(
      'daily_record_clinical_inputs_block_completed',
      'success',
      expect.objectContaining({
        context: expect.objectContaining({
          date,
          endedWith: 'fresh_remote_confirmed',
          blockedForMs: 425,
        }),
      })
    );
    expect(mockRecordEvent).toHaveBeenCalledWith(
      'daily_record_clinical_inputs_block_duration',
      'success',
      expect.objectContaining({
        context: expect.objectContaining({
          date,
          blockedForMs: 425,
        }),
      })
    );
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

    expect(mockRecordEvent).toHaveBeenCalledWith(
      'daily_record_clinical_inputs_block_failed',
      'failed',
      expect.objectContaining({
        context: expect.objectContaining({
          date,
          reason: 'clinical_patch',
          blockedForMs: expect.any(Number),
        }),
      })
    );
  });
});
