// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const functionsRequire = createRequire(require.resolve('../../../functions/package.json'));
const { Timestamp } = functionsRequire('firebase-admin/firestore');
const {
  historyRetentionCutoff,
  selectDailyRecordHistory,
} = require('../../../functions/lib/dailyRecordHistoryRetention');
const { runDailyRecordHistoryPrune } = require('../../../functions/lib/pruneDailyRecordHistory');
import { store, copies } from './dailyRecordHistoryPrune.test-support';

const now = new Date('2026-11-01T17:00:00Z');

const select = (dayId: string, timestamps: unknown[]) =>
  selectDailyRecordHistory({
    dayId,
    cutoffDay: historyRetentionCutoff(now),
    snapshots: timestamps.map((snapshotTimestamp, index) => ({
      id: String(index),
      snapshotTimestamp,
    })),
  });

describe('daily record history retention policy', () => {
  it('does not prune exactly 30 days, but prunes 31 days', () => {
    const timestamps = [1, 2, 3].map(seconds => new Timestamp(seconds, 0));
    expect(historyRetentionCutoff(now)).toBe('2026-10-02');
    expect(select('2026-10-02', timestamps).deleteIds).toEqual([]);
    expect(select('2026-10-01', timestamps).deleteIds).toEqual(['0']);
    expect(select('2026-11-01', timestamps).deleteIds).toEqual([]);
  });

  it.each([
    ['2026-11-01T04:59:59Z', '2026-10-01'],
    ['2026-11-01T05:00:00Z', '2026-10-02'],
    ['2026-07-01T05:59:59Z', '2026-05-31'],
    ['2026-07-01T06:00:00Z', '2026-06-01'],
    ['2024-03-01T17:00:00Z', '2024-01-31'],
  ])('uses hospital midnight and calendar subtraction at %s', (instant, cutoff) => {
    expect(historyRetentionCutoff(new Date(instant))).toBe(cutoff);
  });

  it('orders instants rather than ISO text and keeps nanosecond precision', () => {
    const timestamps = [
      '2026-01-01T10:00:00+14:00', // Older despite the later text.
      '2025-12-31T23:00:00Z',
      new Timestamp(Date.parse('2025-12-31T23:00:00Z') / 1000, 1),
      '2025-12-31T23:00:00.000000002Z',
    ];
    expect(select('2026-01-01', timestamps)).toEqual({
      deleteIds: ['1', '0'],
      keepIds: ['2', '3'],
    });
  });

  it.each([0, 1, 2])('keeps every copy when there are %i', count => {
    expect(
      select(
        '2026-01-01',
        [...copies(count).values()].map(copy => copy.snapshotTimestamp)
      ).deleteIds
    ).toEqual([]);
  });

  it('keeps invalid dates outside the quota and does not mutate its input', () => {
    const timestamps = [
      undefined,
      null,
      'broken',
      '2026-02-30T01:00:00Z',
      '2026-01-01',
      new Date('invalid'),
      { seconds: 1, nanoseconds: -1 },
      new Timestamp(1, 0),
      new Date('2026-01-01T00:00:00Z'),
      new Timestamp(2, 0),
    ];
    const before = [...timestamps];
    expect(select('2026-01-01', timestamps)).toEqual({
      deleteIds: ['7'],
      keepIds: ['0', '1', '2', '3', '4', '5', '6', '8', '9'],
    });
    expect(timestamps).toEqual(before);
  });

  it.each([
    'not-a-day',
    '2026-02-30',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '0000-01-01',
    '2025-02-29',
    '2026-1-01',
  ])('ignores invalid day id %s', dayId => {
    expect(
      select(
        dayId,
        [...copies(3).values()].map(copy => copy.snapshotTimestamp)
      ).deleteIds
    ).toEqual([]);
  });

  it('resolves equal timestamps deterministically across retries', () => {
    const snapshots = ['c', 'b', 'a'].map(id => ({ id, snapshotTimestamp: new Timestamp(1, 0) }));
    const args = { dayId: '2026-01-01', cutoffDay: '2026-10-02', snapshots };
    expect(selectDailyRecordHistory(args).keepIds.sort()).toEqual(['a', 'b']);
    expect(
      selectDailyRecordHistory({ ...args, snapshots: [...snapshots].reverse() }).deleteIds
    ).toEqual(['c']);
  });
});

describe('bounded history-only pruning', () => {
  it('prunes orphan parents in small batches, because copies can be large, leaving recent days and other collections alone', async () => {
    const days = new Map([
      ['2026-01-01', copies(803)],
      ['2026-10-02', copies(3)],
      ['2026-11-01', copies(3)],
      ['2026-02-30', copies(3)],
      ['not-a-day', copies(3)],
    ]);
    const db = store(days);
    const result = await runDailyRecordHistoryPrune({ firestore: db.firestore, now, apply: true });
    expect(result).toEqual({
      daysReviewed: 3,
      snapshotsDeleted: 801,
      snapshotsKept: 2,
      snapshotsToDelete: 801,
      stoppedForTime: false,
    });
    expect(db.batches).toEqual([...Array(40).fill(20), 1]);
    expect([...(days.get('2026-01-01')?.keys() || [])]).toEqual(['copy-801', 'copy-802']);
    expect(db.readDays).toEqual(['2026-01-01']);
    expect(
      db.deletedPaths.every(path =>
        /^hospitals\/hanga_roa\/dailyRecords\/2026-01-01\/history\/copy-\d+$/.test(path)
      )
    ).toBe(true);
    for (const day of ['2026-10-02', '2026-11-01', '2026-02-30', 'not-a-day'])
      expect(days.get(day)?.size).toBe(3);
  });

  it('stops before another batch at the time budget and a later run completes idempotently', async () => {
    let elapsed = 0;
    const days = new Map([
      ['2026-01-01', copies(803)],
      ['2026-01-02', copies(3)],
    ]);
    const db = store(days, () => {
      elapsed = 480_000;
    });
    const first = await runDailyRecordHistoryPrune({
      firestore: db.firestore,
      now,
      apply: true,
      elapsedMs: () => elapsed,
    });
    expect(first).toEqual({
      daysReviewed: 1,
      snapshotsDeleted: 20,
      snapshotsKept: 783,
      snapshotsToDelete: 801,
      stoppedForTime: true,
    });
    const second = await runDailyRecordHistoryPrune({ firestore: db.firestore, now, apply: true });
    expect(second.snapshotsDeleted).toBe(782);
    expect([...days.values()].map(day => day.size)).toEqual([2, 2]);
    expect(
      (await runDailyRecordHistoryPrune({ firestore: db.firestore, now, apply: true }))
        .snapshotsDeleted
    ).toBe(0);
    expect(db.deletedPaths).toHaveLength(new Set(db.deletedPaths).size);
  });

  it('does not start reads when its budget is exhausted', async () => {
    const db = store(new Map([['2026-01-01', copies(3)]]));
    const result = await runDailyRecordHistoryPrune({
      firestore: db.firestore,
      now,
      apply: true,
      elapsedMs: () => 480_000,
    });
    expect(result.daysReviewed).toBe(0);
    expect(result.stoppedForTime).toBe(true);
    expect(db.readDays).toEqual([]);
    expect(db.batches).toEqual([]);
  });

  it('dry-run counts candidates without deleting and failures never count as deletion', async () => {
    const days = new Map([['2026-01-01', copies(3)]]);
    const db = store(days);
    const result = await runDailyRecordHistoryPrune({ firestore: db.firestore, now });
    expect(result.snapshotsToDelete).toBe(1);
    expect(result.snapshotsDeleted).toBe(0);
    expect(result.snapshotsKept).toBe(3);
    expect(db.batches).toEqual([]);
    const failing = {
      ...db.firestore,
      batch: () => ({
        delete: () => {},
        commit: async () => {
          throw new Error('synthetic failure');
        },
      }),
    };
    await expect(
      runDailyRecordHistoryPrune({ firestore: failing, now, apply: true })
    ).rejects.toThrow('synthetic failure');
    expect(days.get('2026-01-01')?.size).toBe(3);
  });
});
