import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  getDailyRecordClinicalFieldLocksByBedId,
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: vi.fn(),
    recordError: vi.fn(),
  },
}));

describe('dailyRecordQueryController subscription freshness', () => {
  afterEach(() => {
    resetDailyRecordFreshnessGateForTests();
  });

  it('confirms freshness when a non-pending snapshot selects the local record', () => {
    const queryClient = new QueryClient();
    const record = DataFactory.createMockDailyRecord('2025-01-08');
    let emit:
      | ((
          result: {
            date: string;
            outcome: 'clean';
            record: typeof record;
            consistencyState: 'remote_applied';
            sourceOfTruth: 'local';
            retryability: 'not_applicable';
            recoveryAction: 'none';
            conflictSummary: null;
            observabilityTags: string[];
            repairApplied: false;
          },
          hasPendingWrites: boolean
        ) => void)
      | undefined;
    const subscribeDetailed = vi.fn((_date, callback) => {
      emit = callback;
      return vi.fn();
    });

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);
    expect(getDailyRecordFreshnessStatus('2025-01-08')).toBe('stale_due_to_inactivity');

    createDailyRecordSubscription(
      { getForDate: vi.fn(), subscribeDetailed },
      '2025-01-08',
      queryClient
    );

    emit?.(
      {
        date: '2025-01-08',
        outcome: 'clean',
        record,
        consistencyState: 'remote_applied',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'sync'],
        repairApplied: false,
      },
      false
    );

    expect(getDailyRecordFreshnessStatus('2025-01-08')).toBe('fresh_remote_confirmed');
  });

  it('keeps clinical field locks when a realtime subscription hydrates newer remote data', () => {
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.lastUpdated = '2025-01-08T10:00:00.000Z';
    previousRecord.beds.R1.pathology = 'Diagnostico local antiguo';

    const remoteRecord = {
      ...previousRecord,
      lastUpdated: '2025-01-08T10:10:00.000Z',
      beds: {
        ...previousRecord.beds,
        R1: {
          ...previousRecord.beds.R1,
          pathology: 'Diagnostico remoto vigente',
        },
      },
    };

    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    let emit:
      | ((
          result: {
            date: string;
            outcome: 'clean';
            record: typeof remoteRecord;
            consistencyState: 'remote_applied';
            sourceOfTruth: 'remote';
            retryability: 'not_applicable';
            recoveryAction: 'none';
            conflictSummary: {
              kind: 'hydrated_from_remote';
              sourceOfTruth: 'remote';
              localTimestamp: string;
              remoteTimestamp: string;
            };
            observabilityTags: string[];
            repairApplied: false;
          },
          hasPendingWrites: boolean
        ) => void)
      | undefined;
    const subscribeDetailed = vi.fn((_date, callback) => {
      emit = callback;
      return vi.fn();
    });

    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);

    createDailyRecordSubscription(
      { getForDate: vi.fn(), subscribeDetailed },
      '2025-01-08',
      queryClient
    );

    emit?.(
      {
        date: '2025-01-08',
        outcome: 'clean',
        record: remoteRecord,
        consistencyState: 'remote_applied',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: {
          kind: 'hydrated_from_remote',
          sourceOfTruth: 'remote',
          localTimestamp: previousRecord.lastUpdated,
          remoteTimestamp: remoteRecord.lastUpdated,
        },
        observabilityTags: ['daily_record', 'sync'],
        repairApplied: false,
      },
      false
    );

    expect(getDailyRecordFreshnessStatus('2025-01-08')).toBe('fresh_remote_confirmed');
    expect(getDailyRecordClinicalFieldLocksByBedId('2025-01-08')?.R1?.diagnosis).toBe(true);
  });
});
