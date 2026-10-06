import {
  createDailyRecordReadResult,
  type DailyRecordReadResult,
  type DailyRecordQueryResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  applyPendingExplicitCensusPatch,
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn(), recordError: vi.fn() },
}));

const date = '2025-01-08';
const readResult = (record: DailyRecord | null) =>
  createDailyRecordReadResult(date, record, record ? 'indexeddb' : 'not_found');
const recordAt = (hour: string) => ({
  ...DataFactory.createMockDailyRecord(date),
  lastUpdated: `${date}T${hour}:00:00.000Z`,
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup() {
  const client = new QueryClient();
  const read = Promise.withResolvers<DailyRecord | null>();
  let emit!: (record: DailyRecord | null, pending: boolean) => void;
  setDailyRecordQueryData(client, date, recordAt('10'));
  const stop = createDailyRecordSubscription(
    {
      getForDateWithMeta: () => read.promise.then(readResult),
      subscribe: (_date, callback) => {
        emit = callback;
        return vi.fn();
      },
    },
    date,
    client
  );
  return {
    client,
    read,
    emit,
    stop,
    value: () => client.getQueryData(getDailyRecordQueryKey(date)),
  };
}

describe('null realtime recovery ownership', () => {
  afterEach(clearPendingDailyRecordPatchesForTests);

  it.each(['record', 'missing', 'error'] as const)(
    'does not overwrite a newer snapshot with delayed %s',
    async outcome => {
      const s = setup();
      s.emit(null, false);
      s.emit(recordAt('12'), false);
      const current = s.value();
      if (outcome === 'error') s.read.reject(new Error('read failed'));
      else s.read.resolve(outcome === 'missing' ? null : recordAt('11'));
      await settle();
      expect(s.value()).toBe(current);
      s.stop?.();
    }
  );

  it('preserves an edit published while the recovery is pending', async () => {
    const s = setup();
    s.emit(null, false);
    setDailyRecordQueryData(s.client, date, recordAt('13'));
    const current = s.value();
    s.read.resolve(null);
    await settle();
    expect(s.value()).toBe(current);
    s.stop?.();
  });

  it('lets only the latest null emission reconcile an unchanged cache', async () => {
    const client = new QueryClient();
    const first = Promise.withResolvers<DailyRecord | null>();
    const second = Promise.withResolvers<DailyRecord | null>();
    let emit!: (record: DailyRecord | null, pending: boolean) => void;
    setDailyRecordQueryData(client, date, recordAt('10'));
    const stop = createDailyRecordSubscription(
      {
        getForDateWithMeta: vi
          .fn()
          .mockImplementationOnce(() => first.promise.then(readResult))
          .mockImplementationOnce(() => second.promise.then(readResult)),
        subscribe: (_date, callback) => {
          emit = callback;
          return vi.fn();
        },
      },
      date,
      client
    );
    emit(null, false);
    emit(null, false);
    first.resolve(null);
    await settle();
    expect(client.getQueryData(getDailyRecordQueryKey(date))).toMatchObject({
      record: recordAt('10'),
    });
    second.resolve(recordAt('12'));
    await settle();
    expect(client.getQueryData(getDailyRecordQueryKey(date))).toMatchObject({
      record: recordAt('12'),
    });
    stop?.();
  });

  it('projects pending edits on the recovered record', async () => {
    const s = setup();
    const previous = recordAt('10');
    previous.beds.R1.clinicalEpisodeId = 'episode-test';
    setDailyRecordQueryData(s.client, date, previous);
    const unregister = registerPendingDailyRecordPatch(date, {
      'beds.R1.pathology': 'Pending synthetic diagnosis',
    });
    s.emit(null, false);
    s.read.resolve({ ...previous, lastUpdated: `${date}T11:00:00.000Z` });
    await settle();
    expect(s.value()).toMatchObject({
      record: { beds: { R1: { pathology: 'Pending synthetic diagnosis' } } },
    });
    unregister();
    s.stop?.();
  });

  it('invalidates recovery even when an optimistic rollback restores the same object', async () => {
    const s = setup();
    const original = s.value();
    s.emit(null, false);
    setDailyRecordQueryData(s.client, date, recordAt('13'));
    s.client.setQueryData(getDailyRecordQueryKey(date), original);
    s.read.resolve(null);
    await settle();
    expect(s.value()).toEqual(original);
    s.stop?.();
  });

  it.each(['remove', 'reset'] as const)(
    'discards recovery after cache %s and replacement',
    async action => {
      const s = setup();
      s.emit(null, false);
      const filters = { queryKey: getDailyRecordQueryKey(date), exact: true };
      if (action === 'remove') s.client.removeQueries(filters);
      else await s.client.resetQueries(filters);
      setDailyRecordQueryData(s.client, date, recordAt('13'));
      const current = s.value();
      s.read.resolve(null);
      await settle();
      expect(s.value()).toBe(current);
      s.stop?.();
    }
  );

  it('preserves a newer invalidation while recovery is pending', async () => {
    const s = setup();
    s.emit(null, false);
    await s.client.invalidateQueries({
      queryKey: getDailyRecordQueryKey(date),
      exact: true,
      refetchType: 'none',
    });
    const current = s.value();
    s.read.resolve(null);
    await settle();
    expect(s.value()).toBe(current);
    expect(s.client.getQueryState(getDailyRecordQueryKey(date))?.isInvalidated).toBe(true);
    s.stop?.();
  });

  it('allows an owned confirmation of absence', async () => {
    const s = setup();
    s.emit(null, false);
    s.read.resolve(null);
    await settle();
    expect(s.value()).toMatchObject({
      record: null,
      runtime: { availabilityState: 'confirmed_missing' },
    });
    s.stop?.();
  });
  it.each([
    'unavailable',
    'unavailable_older',
    'older',
    'confirmed_missing',
    'newer',
    'authoritative',
  ] as const)('uses the read precedence contract for %s recovery', async outcome => {
    const client = new QueryClient();
    const record = recordAt('12');
    record.beds.R1.clinicalEpisodeId = 'synthetic-episode';
    record.beds.R1.pathology = 'Pending synthetic diagnosis';
    const previous: DailyRecordQueryResult = {
      record,
      runtime: {
        date,
        availabilityState: 'resolved',
        consistencyState: outcome === 'authoritative' ? 'local_only' : 'remote_authoritative',
        sourceOfTruth: outcome === 'authoritative' ? 'local' : 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    };
    client.setQueryData(getDailyRecordQueryKey(date), previous);
    const recovery = Promise.withResolvers<DailyRecordReadResult>();
    let emit!: (record: DailyRecord | null, pending: boolean) => void;
    const stop = createDailyRecordSubscription(
      {
        getForDateWithMeta: () => recovery.promise,
        subscribe: (_date, callback) => {
          emit = callback;
          return vi.fn();
        },
      },
      date,
      client
    );
    vi.mocked(dailyRecordObservability.recordEvent).mockClear();
    const isUnavailable = outcome.startsWith('unavailable');
    const mustKeepPrevious = isUnavailable || outcome === 'older';
    const unregister = mustKeepPrevious
      ? registerPendingDailyRecordPatch(date, {
          'beds.R1.pathology': 'Pending synthetic diagnosis',
        })
      : () => {};
    try {
      emit(null, false);
      const recoveredRecord =
        outcome === 'confirmed_missing' || outcome === 'unavailable'
          ? null
          : { ...record, lastUpdated: `${date}T${outcome === 'newer' ? '13' : '11'}:00:00.000Z` };
      recovery.resolve(
        createDailyRecordReadResult(
          date,
          recoveredRecord,
          recoveredRecord ? 'firestore' : 'not_found',
          isUnavailable
            ? {
                consistencyState: 'unavailable',
                sourceOfTruth: recoveredRecord ? 'local' : 'none',
                retryability: 'automatic_retry',
                recoveryAction: 'defer_remote_sync',
                userSafeMessage: 'Synthetic unavailable',
              }
            : {}
        )
      );
      await settle();
      const current = client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date));
      expect(current?.record?.lastUpdated ?? null).toBe(
        mustKeepPrevious ? record.lastUpdated : (recoveredRecord?.lastUpdated ?? null)
      );
      if (isUnavailable)
        expect(current?.runtime).toMatchObject({
          availabilityState:
            outcome === 'unavailable' ? 'temporarily_unavailable' : 'recoverable_local',
          consistencyState: 'unavailable',
          sourceOfTruth: 'remote',
          userSafeMessage: 'Synthetic unavailable',
        });
      if (outcome === 'older') {
        expect(dailyRecordObservability.recordEvent).toHaveBeenCalledWith(
          'recovered_null_realtime_record',
          'degraded',
          expect.objectContaining({
            context: expect.objectContaining({
              previousLastUpdated: record.lastUpdated,
              recoveredLastUpdated: recoveredRecord?.lastUpdated,
              retainedPreviousRecord: true,
            }),
          })
        );
      }
      if (outcome === 'unavailable' || outcome === 'confirmed_missing') {
        const confirmedMissing = outcome === 'confirmed_missing';
        expect(dailyRecordObservability.recordEvent).toHaveBeenCalledWith(
          confirmedMissing ? 'confirmed_null_realtime_record' : 'unavailable_null_realtime_record',
          'degraded',
          expect.objectContaining({ runtimeState: confirmedMissing ? 'retryable' : 'blocked' })
        );
        if (!confirmedMissing)
          expect(dailyRecordObservability.recordEvent).not.toHaveBeenCalledWith(
            'confirmed_null_realtime_record',
            expect.anything(),
            expect.anything()
          );
      }
      if (outcome === 'confirmed_missing')
        expect(current?.runtime.availabilityState).toBe('confirmed_missing');
      if (outcome === 'authoritative') expect(current?.runtime.sourceOfTruth).toBe('remote');
      if (mustKeepPrevious) {
        const next = {
          ...record,
          beds: {
            ...record.beds,
            R1: { ...record.beds.R1, pathology: 'Older server diagnosis' },
          },
        };
        expect(applyPendingExplicitCensusPatch(date, next, record).beds.R1.pathology).toBe(
          'Pending synthetic diagnosis'
        );
      }
    } finally {
      unregister();
      stop?.();
      client.clear();
    }
  });
});
