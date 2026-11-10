import 'fake-indexeddb/auto';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { syncRecordsRange } from '@/services/records/recordQueryService';

const remote = vi.hoisted(() => vi.fn());
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordsRangeFromFirestore: remote,
}));

const date = '2026-04-02';
const record = (note: string) =>
  DataFactory.createMockDailyRecord(date, { medicalHandoffNovedades: note });

describe('range download with real local storage', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    remote.mockReset();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it.each(['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'] satisfies SyncTask['status'][])(
    'keeps and returns the %s local note while leaving its queue task intact',
    async status => {
      const local = record('Nota local nueva');
      await hospitalDB.dailyRecords.put(local);
      const id = await hospitalDB.syncQueue.add({
        opId: 'synthetic-pending',
        key: `daily:${date}`,
        type: 'UPDATE_DAILY_RECORD',
        status,
        payload: local,
        timestamp: 1,
        retryCount: 0,
      });
      const task = await hospitalDB.syncQueue.get(id);
      remote.mockResolvedValue([record('Nota remota anterior')]);
      const result = await syncRecordsRange(date, date);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(local);
      expect(result).toEqual([local]);
      expect(await hospitalDB.syncQueue.get(id)).toEqual(task);
    }
  );

  it('rejects, storing nothing, when the local write fails', async () => {
    const local = record('Nota local nueva');
    await hospitalDB.dailyRecords.put(local);
    await hospitalDB.syncQueue.add({
      opId: 'synthetic-pending',
      key: `daily:${date}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: local,
      timestamp: 1,
      retryCount: 0,
    });
    remote.mockResolvedValue([record('Remota'), { ...record('Remota'), date: '2026-04-03' }]);
    vi.spyOn(hospitalDB.dailyRecords, 'bulkPut').mockRejectedValue(
      new Error('synthetic storage failure')
    );
    await expect(syncRecordsRange(date, '2026-04-03')).rejects.toThrow('synthetic storage failure');
    expect(await hospitalDB.dailyRecords.toArray()).toEqual([local]);
  });

  it('writes nothing if a pending task has lost its local copy', async () => {
    await hospitalDB.syncQueue.add({
      opId: 'synthetic-missing-copy',
      key: `daily:${date}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: record('Pendiente'),
      timestamp: 1,
      retryCount: 0,
    });
    remote.mockResolvedValue([record('Remota')]);
    await expect(syncRecordsRange(date, date)).rejects.toThrow('No existe la copia local');
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
    expect(await hospitalDB.syncQueue.count()).toBe(1);
  });

  it('stores unheld days unchanged', async () => {
    const records = [record('Remota')];
    remote.mockResolvedValue(records);
    expect(await syncRecordsRange(date, date)).toEqual(records);
    expect(await hospitalDB.dailyRecords.toArray()).toEqual(records);
  });

  it('downloads 366 days in one transaction and keeps mixed pending work', async () => {
    const records = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].flatMap((days, month) =>
      Array.from({ length: days }, (_, day) => ({
        ...record('Remota'),
        date: `2024-${String(month + 1).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`,
      }))
    );
    const local = { ...record('Local pendiente'), date: '2024-06-01' };
    await hospitalDB.dailyRecords.put(local);
    await hospitalDB.syncQueue.add({
      opId: 'synthetic-year',
      key: `daily:${local.date}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: local,
      timestamp: 1,
      retryCount: 0,
    });
    remote.mockResolvedValue(records);
    const transaction = vi.spyOn(hospitalDB, 'transaction');
    const result = await syncRecordsRange('2024-01-01', '2024-12-31');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual(records.map(day => (day.date === local.date ? local : day)));
    expect(await hospitalDB.dailyRecords.count()).toBe(366);
    expect(await hospitalDB.dailyRecords.get(local.date)).toEqual(local);
  });

  it('returns an empty remote range without writing', async () => {
    remote.mockResolvedValue([]);
    const write = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    expect(await syncRecordsRange(date, date)).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });
});
