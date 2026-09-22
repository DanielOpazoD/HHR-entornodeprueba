import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  createReconciledDailyRecordQueryFn,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { setRemoteConfirmedDailyRecordQueryData } from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import { reconcileDailyRecordQueryResult } from '@/hooks/controllers/dailyRecordQueryResultPrecedence';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn(), recordError: vi.fn() },
}));

const queryResult = (
  record: DailyRecordQueryResult['record'],
  sourceOfTruth: DailyRecordQueryResult['runtime']['sourceOfTruth'],
  runtime: Partial<DailyRecordQueryResult['runtime']> = {}
): DailyRecordQueryResult => ({
  record,
  runtime: {
    date: '2025-01-08',
    availabilityState: record ? 'resolved' : 'confirmed_missing',
    consistencyState: record ? 'local_only' : 'missing',
    sourceOfTruth,
    retryability: 'not_applicable',
    recoveryAction: 'none',
    conflictSummary: null,
    observabilityTags: ['daily_record', 'read'],
    repairApplied: false,
    ...runtime,
  },
});

describe('confirmed cache ordering across query and subscription', () => {
  it('requires the known confirmed revision to clear an outstanding authority failure', () => {
    const confirmed = {
      ...DataFactory.createMockDailyRecord('2025-01-08'),
      lastUpdated: '2025-01-08T10:20:00.000Z',
    };
    const unavailable = queryResult(confirmed, 'remote', {
      consistencyState: 'unavailable',
      availabilityState: 'temporarily_unavailable',
    });
    const delayed = queryResult(
      { ...confirmed, lastUpdated: '2025-01-08T10:00:00.000Z' },
      'remote'
    );
    expect(reconcileDailyRecordQueryResult(unavailable, delayed)).toBe(unavailable);
    const recovered = queryResult(confirmed, 'remote', {
      consistencyState: 'remote_authoritative',
    });
    expect(reconcileDailyRecordQueryResult(unavailable, recovered)).toBe(recovered);
  });

  it('publishes subscription unavailability without replacing newer confirmed data', () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const previous = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:20:00.000Z',
    };
    queryClient.setQueryData(getDailyRecordQueryKey(date), queryResult(previous, 'remote'));
    createDailyRecordSubscription(
      {
        getForDate: vi.fn(),
        subscribeDetailed: vi.fn((_date, callback) => {
          callback(
            {
              date,
              outcome: 'blocked',
              record: { ...previous, lastUpdated: '2025-01-08T10:00:00.000Z' },
              consistencyState: 'unavailable',
              sourceOfTruth: 'local',
              retryability: 'automatic_retry',
              recoveryAction: 'defer_remote_sync',
              conflictSummary: null,
              observabilityTags: ['daily_record', 'sync'],
              repairApplied: false,
            },
            false
          );
          return vi.fn();
        }),
      },
      date,
      queryClient
    );
    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: previous,
      runtime: { consistencyState: 'unavailable', sourceOfTruth: 'remote' },
    });
  });

  it('reconciles a delayed read against the cache present when it completes', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const older = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:00:00.000Z',
    };
    const newer = { ...older, lastUpdated: '2025-01-08T10:20:00.000Z' };
    let finishRead!: (record: typeof older) => void;
    const read = new Promise<typeof older>(resolve => {
      finishRead = resolve;
    });
    const queryFn = createReconciledDailyRecordQueryFn(
      { getForDate: () => read },
      date,
      queryClient
    );
    queryClient.setQueryData(getDailyRecordQueryKey(date), queryResult(older, 'remote'));
    const pending = queryClient.fetchQuery({ queryKey: getDailyRecordQueryKey(date), queryFn });
    queryClient.setQueryData(getDailyRecordQueryKey(date), queryResult(newer, 'remote'));
    finishRead(older);
    await pending;
    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record
    ).toEqual(newer);
  });

  it('keeps an ACK when an older subscription resolution finishes after a local-authoritative refetch', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const staleRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:00:00.000Z',
      rayenSyncHistory: [],
    };
    const confirmedRecord = {
      ...staleRecord,
      lastUpdated: '2025-01-08T10:10:00.000Z',
      rayenSyncHistory: [
        {
          id: 'run-current',
          sourceDate: date,
          startedAt: '2025-01-08T10:09:00.000Z',
          completedAt: '2025-01-08T10:10:00.000Z',
          by: 'Enfermera Demo',
          status: 'applied' as const,
        },
      ],
    };
    let publishDelayedSubscription!: (
      result: Parameters<
        NonNullable<Parameters<typeof createDailyRecordSubscription>[0]['subscribeDetailed']>
      >[1] extends (result: infer Result, pending: boolean) => void
        ? Result
        : never,
      pending: boolean
    ) => void;
    createDailyRecordSubscription(
      {
        getForDate: vi.fn(),
        subscribeDetailed: vi.fn((_date, callback) => {
          publishDelayedSubscription = callback;
          return vi.fn();
        }),
      },
      date,
      queryClient
    );
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedRecord);

    const postAckRead = createReconciledDailyRecordQueryFn(
      {
        getForDate: vi.fn(),
        getForDateWithMeta: vi.fn().mockResolvedValue({
          date,
          record: confirmedRecord,
          source: 'indexeddb',
          compatibilityTier: 'local_runtime',
          compatibilityIntensity: 'none',
          migrationRulesApplied: [],
          consistencyState: 'local_authoritative',
          sourceOfTruth: 'local',
          retryability: 'manual_review',
          recoveryAction: 'defer_remote_sync',
          conflictSummary: null,
          observabilityTags: ['daily_record', 'read', 'local_authoritative'],
          repairApplied: false,
        }),
      },
      date,
      queryClient
    );
    queryClient.setQueryData<DailyRecordQueryResult>(
      getDailyRecordQueryKey(date),
      await postAckRead()
    );

    publishDelayedSubscription(
      {
        date,
        outcome: 'clean',
        record: staleRecord,
        consistencyState: 'remote_applied',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'sync'],
        repairApplied: false,
      },
      false
    );

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record
        ?.rayenSyncHistory
    ).toEqual(confirmedRecord.rayenSyncHistory);
  });

  it('accepts a genuinely newer pending local projection', () => {
    const previous = DataFactory.createMockDailyRecord('2025-01-08');
    previous.lastUpdated = '2025-01-08T10:10:00.000Z';
    const incoming = { ...previous, lastUpdated: '2025-01-08T10:20:00.000Z' };

    expect(
      reconcileDailyRecordQueryResult(
        queryResult(previous, 'remote'),
        queryResult(incoming, 'local')
      ).record
    ).toBe(incoming);
  });

  it('accepts remote authority over a future-clock local projection', () => {
    const remote = DataFactory.createMockDailyRecord('2025-01-08');
    remote.lastUpdated = '2025-01-08T10:20:00.000Z';
    const optimistic = { ...remote, lastUpdated: '2025-01-08T10:30:00.000Z' };

    expect(
      reconcileDailyRecordQueryResult(
        queryResult(optimistic, 'local'),
        queryResult(remote, 'remote')
      ).record
    ).toBe(remote);
  });

  it('surfaces unavailable and confirmed-missing query states', () => {
    const previous = DataFactory.createMockDailyRecord('2025-01-08');
    const unavailable = queryResult(previous, 'local', {
      availabilityState: 'temporarily_unavailable',
      consistencyState: 'unavailable',
      conflictSummary: {
        kind: 'remote_unavailable',
        sourceOfTruth: 'local',
        changedPaths: [],
        message: 'Temporalmente no disponible',
      },
    });
    const missing = queryResult(null, 'none');

    expect(
      reconcileDailyRecordQueryResult(queryResult(previous, 'remote'), unavailable)
    ).toMatchObject({
      record: previous,
      runtime: {
        sourceOfTruth: 'remote',
        consistencyState: 'unavailable',
        conflictSummary: { kind: 'remote_unavailable' },
      },
    });
    expect(reconcileDailyRecordQueryResult(queryResult(previous, 'remote'), missing)).toBe(missing);
  });

  it.each(['older', 'absent'] as const)(
    'keeps last confirmed data with an %s unavailable fallback',
    kind => {
      const previous = {
        ...DataFactory.createMockDailyRecord('2025-01-08'),
        lastUpdated: '2025-01-08T10:20:00.000Z',
      };
      const fallback =
        kind === 'older' ? { ...previous, lastUpdated: '2025-01-08T10:00:00.000Z' } : null;
      const result = reconcileDailyRecordQueryResult(
        queryResult(previous, 'remote'),
        queryResult(fallback, 'local', {
          availabilityState: 'temporarily_unavailable',
          consistencyState: 'unavailable',
          retryability: 'automatic_retry',
        })
      );
      expect(result.record).toBe(previous);
      expect(result.runtime).toMatchObject({
        sourceOfTruth: 'remote',
        consistencyState: 'unavailable',
        availabilityState: 'temporarily_unavailable',
        retryability: 'automatic_retry',
      });
    }
  );
});
