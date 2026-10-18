import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  createDailyRecordQueryFn,
  createReconciledDailyRecordQueryFn,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resolveDailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import { createNotFoundDailyRecordReadResult } from '@/services/repositories/dailyRecordReadResultController';
import {
  createDailyRecordReadResult,
  type DailyRecordReadResult,
  type DailyRecordQueryResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { DataFactory } from '@/tests/factories/DataFactory';
const date = '2026-10-18';
const phase = (result: DailyRecordQueryResult, fetching = false, selected = date) =>
  resolveDailyRecordBootstrapPhase({
    remoteSyncStatus: 'ready',
    record: result.record,
    runtime: result.runtime,
    gracePeriodExpired: false,
    currentDateString: selected,
    isFetching: fetching,
  });

describe('absence evidence across local cache, Firebase and bootstrap', () => {
  it('never converts a local-only miss to an empty census when remote auth becomes ready', async () => {
    const reader = {
      getForDateWithMeta: vi
        .fn()
        .mockResolvedValue(createNotFoundDailyRecordReadResult(date, 'not_requested')),
    };
    const result = await createDailyRecordQueryFn(reader, date, false)();
    expect(result.runtime.availabilityState).toBe('unconfirmed_missing');
    expect(phase(result)).toBe('remote_record_bootstrapping');
  });
  it('keeps loading while remote data is pending and goes directly to the populated register', async () => {
    let release!: (value: DailyRecordReadResult) => void;
    const reader = {
      getForDateWithMeta: vi
        .fn()
        .mockImplementationOnce(async () =>
          createNotFoundDailyRecordReadResult(date, 'not_requested')
        )
        .mockImplementationOnce(
          () =>
            new Promise<DailyRecordReadResult>(resolve => {
              release = resolve;
            })
        ),
    };
    const local = await createDailyRecordQueryFn(reader, date, false)();
    const pending = createDailyRecordQueryFn(reader, date, true)();
    expect(phase(local, true)).toBe('remote_record_bootstrapping');
    release(
      createDailyRecordReadResult(date, DataFactory.createMockDailyRecord(date), 'firestore')
    );
    expect(phase(await pending)).toBe('record_ready');
  });
  it('requires settled, authoritative absence for the exact selected date', async () => {
    const reader = {
      getForDateWithMeta: vi
        .fn()
        .mockResolvedValue(createNotFoundDailyRecordReadResult(date, 'missing')),
    };
    const confirmed = await createDailyRecordQueryFn(reader, date, true)();
    expect(phase(confirmed)).toBe('confirmed_empty');
    expect(phase(confirmed, true)).toBe('remote_record_bootstrapping');
    expect(phase(confirmed, false, '2026-10-19')).toBe('remote_record_bootstrapping');
    expect(phase({ ...confirmed, runtime: { ...confirmed.runtime, conflictSummary: null } })).toBe(
      'remote_record_bootstrapping'
    );
  });
  it('does not let an older in-flight absence erase a newer realtime record', async () => {
    const client = new QueryClient();
    let release!: (value: DailyRecordReadResult) => void;
    const reader = {
      getForDateWithMeta: vi.fn(
        () =>
          new Promise<DailyRecordReadResult>(resolve => {
            release = resolve;
          })
      ),
    };
    const pending = createReconciledDailyRecordQueryFn(reader, date, client)();
    const record = DataFactory.createMockDailyRecord(date);
    const fresh = await createDailyRecordQueryFn(
      {
        getForDateWithMeta: vi
          .fn()
          .mockResolvedValue(createDailyRecordReadResult(date, record, 'firestore')),
      },
      date
    )();
    client.setQueryData(getDailyRecordQueryKey(date), fresh);
    release(createNotFoundDailyRecordReadResult(date, 'missing'));
    expect((await pending).record).toEqual(record);
    client.clear();
  });
});
