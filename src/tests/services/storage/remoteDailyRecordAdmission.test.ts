import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { syncRecordsRange } from '@/services/records/recordQueryService';
import { hydrateRangeRecords } from '@/services/admin/dataMaintenanceSupport';
import * as persistence from '@/services/repositories/dailyRecordLocalCachePersistence';

const remote = vi.hoisted(() => vi.fn());
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordsRangeFromFirestore: remote,
}));
vi.mock('@/services/storage/firestore', () => ({ getRecordsRangeFromFirestore: remote }));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));

const day = (date: string) => DataFactory.createMockDailyRecord(date);
beforeEach(async () => {
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});

describe.each([syncRecordsRange, hydrateRangeRecords])('batch reader %s', read => {
  it('keeps the last duplicate date durable and returns one row for that date', async () => {
    const first = day('2026-04-01');
    const last = { ...first, medicalHandoffNovedades: 'Última copia sintética' };
    remote.mockResolvedValue([first, last]);
    // One decision per date: the reader answers with the row it stored, not with both copies.
    expect(await read(first.date, first.date)).toEqual([last]);
    expect(await hospitalDB.dailyRecords.toArray()).toEqual([last]);
  });

  it('rolls back an actual partial IndexedDB write', async () => {
    const records = [day('2026-04-01'), day('2026-04-02')];
    remote.mockResolvedValue(records);
    const failSecond = (_key: unknown, record: { date: string }) => {
      if (record.date === records[1].date) throw new Error('synthetic second row failure');
    };
    hospitalDB.dailyRecords.hook('creating', failSecond);
    try {
      await expect(read(records[0].date, records[1].date)).rejects.toThrow();
      expect(await hospitalDB.dailyRecords.count()).toBe(0);
    } finally {
      hospitalDB.dailyRecords.hook('creating').unsubscribe(failSecond);
    }
  });

  it('writes 366 days in a single transaction', async () => {
    const records = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].flatMap((days, month) =>
      Array.from({ length: days }, (_, index) =>
        day(`2024-${String(month + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`)
      )
    );
    remote.mockResolvedValue(records);
    const transaction = vi.spyOn(hospitalDB, 'transaction');
    expect(await read('2024-01-01', '2024-12-31')).toEqual(records);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.dailyRecords.toArray()).toEqual(records);
  });

  it('rejects the entire batch when an active task has no local copy', async () => {
    const records = [day('2026-04-01'), day('2026-04-02')];
    await hospitalDB.syncQueue.add({
      opId: 'synthetic-missing',
      key: `daily:${records[1].date}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: records[1],
      timestamp: 1,
      retryCount: 0,
    });
    const tasks = await hospitalDB.syncQueue.toArray();
    remote.mockResolvedValue(records);
    await expect(read(records[0].date, records[1].date)).rejects.toThrow();
    expect(await hospitalDB.dailyRecords.count()).toBe(0);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
  });
});

it('exposes one decision per date with separate remote evidence', async () => {
  const record = day('2026-04-01');
  const remoteRecord = { ...record, medicalHandoffNovedades: 'Evidencia remota sintética' };
  expect(persistence).toHaveProperty('admitRemoteDailyRecords');
  const results = await persistence.admitRemoteDailyRecords([
    { record: remoteRecord, remoteRecord },
    { record, remoteRecord },
  ]);
  expect(results).toEqual([{ date: record.date, status: 'admitted', record, remoteRecord }]);
  expect(await hospitalDB.dailyRecords.toArray()).toEqual([record]);
});

it.each(['retained_pending', 'superseded'] as const)(
  'returns the durable %s row separately from remote evidence',
  async status => {
    const record = day('2026-04-01');
    const remoteRecord = { ...record, medicalHandoffNovedades: 'Remota sintética' };
    await hospitalDB.dailyRecords.put(record);
    if (status === 'retained_pending') {
      await hospitalDB.syncQueue.add({
        opId: 'synthetic-held',
        key: `daily:${record.date}`,
        type: 'UPDATE_DAILY_RECORD',
        status: 'PENDING',
        payload: record,
        timestamp: 1,
        retryCount: 0,
      });
    }
    const tasks = await hospitalDB.syncQueue.toArray();
    const results = await persistence.admitRemoteDailyRecords([
      {
        record: remoteRecord,
        remoteRecord,
        expectedBase: { kind: 'stored', record: null },
      },
    ]);
    expect(results).toEqual([{ date: record.date, status, record, remoteRecord }]);
    expect(await hospitalDB.dailyRecords.toArray()).toEqual([record]);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
  }
);
