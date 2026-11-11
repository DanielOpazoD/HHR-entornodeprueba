import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { initializeDayDetailed } from '@/services/repositories/dailyRecordRepositoryInitializationService';
const wire = vi.hoisted(() => ({ fail: false, changeOwner: false }));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestoreDetailed: vi.fn(async (date: string) => {
    if (wire.changeOwner) localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-other');
    if (wire.fail) throw new Error('Synthetic network failure');
    return {
      record: DataFactory.createMockDailyRecord(date, {
        lastUpdated: '2026-10-24T12:00:00.000Z',
        nursesDayShift: ['SERVER'],
      }),
      serverConfirmed: true,
    };
  }),
}));
const date = '2026-10-24';
beforeEach(async () => {
  wire.fail = false;
  wire.changeOwner = false;
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-a5');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
});
afterEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  vi.restoreAllMocks();
});
for (const path of ['P', 'I'] as const) {
  for (const holder of [false, true]) {
    it(`${path} uses admission with holder=${holder}`, async () => {
      const local = DataFactory.createMockDailyRecord(date, {
        lastUpdated: '2026-10-24T23:00:00.000Z',
        nursesDayShift: ['LOCAL'],
      });
      await hospitalDB.dailyRecords.put(local);
      if (holder)
        await hospitalDB.syncQueue.add({
          type: 'UPDATE_DAILY_RECORD',
          key: `daily:${date}`,
          payload: local,
          status: 'FAILED',
          retryCount: 3,
          timestamp: 1,
        });
      const tasks = await hospitalDB.syncQueue.toArray();
      const result =
        path === 'P' ? await getForDateWithMeta(date) : await initializeDayDetailed(date);
      expect(result.record?.nursesDayShift).toEqual([holder ? 'LOCAL' : 'SERVER']);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(result.record);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    });
  }
}
it('E does not admit after owner changes during network', async () => {
  wire.changeOwner = true;
  const result = await syncWithFirestoreDetailed(date);
  expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  expect(result?.serverConfirmed).toBe(false);
});
it('I rejects failed remote evidence instead of creating a day', async () => {
  wire.fail = true;
  await expect(initializeDayDetailed(date)).rejects.toThrow('Synthetic network failure');
  expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
});
