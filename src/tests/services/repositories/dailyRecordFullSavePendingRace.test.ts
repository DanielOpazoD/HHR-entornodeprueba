import { beforeEach, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';

type Queue = (typeof import('@/services/storage/sync'))['queueDailyRecordSyncTaskWithLocalRecord'];
const boundary = vi.hoisted((): { queue: Queue; beforeQueue?: () => Promise<void> } => ({
  queue: vi.fn<Queue>(),
}));
vi.mock('@/services/storage/sync', async original => {
  const actual = await original<typeof import('@/services/storage/sync')>();
  boundary.queue = actual.queueDailyRecordSyncTaskWithLocalRecord;
  return {
    ...actual,
    queueDailyRecordSyncTaskWithLocalRecord: async (...args: Parameters<Queue>) => {
      await boundary.beforeQueue?.();
      return actual.queueDailyRecordSyncTaskWithLocalRecord(...args);
    },
  };
});
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => false }));
vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: { upsertPatient: vi.fn() },
}));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';

const date = '2026-10-27';
beforeEach(async () => {
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  boundary.beforeQueue = undefined;
});

it('rejects a full save overtaken after preparation and accepts a retry from the retained edit', async () => {
  const base = DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T10:00:00.000Z`,
    nursesDayShift: ['SYNTHETIC BASE'],
    tensDayShift: ['SYNTHETIC BASE'],
  });
  await hospitalDB.dailyRecords.put(base);
  boundary.beforeQueue = async () => {
    boundary.beforeQueue = undefined;
    await boundary.queue(
      { ...base, lastUpdated: `${date}T10:01:00.000Z`, nursesDayShift: ['SYNTHETIC A'] },
      { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['nursesDayShift'] } },
      { wholeRecordBase: base }
    );
  };
  await expect(
    saveDetailed(
      { ...base, lastUpdated: `${date}T10:02:00.000Z`, tensDayShift: ['SYNTHETIC B'] },
      base.lastUpdated,
      { baseRecord: base }
    )
  ).rejects.toMatchObject({ name: 'ConcurrencyError' });
  const retained = await hospitalDB.dailyRecords.get(date);
  expect(retained?.nursesDayShift).toEqual(['SYNTHETIC A']);
  expect((await hospitalDB.syncQueue.toArray())[0].payload).toMatchObject({
    nursesDayShift: ['SYNTHETIC A'],
  });
  if (!retained) throw new Error('Missing synthetic accepted projection');
  const result = await saveDetailed(
    { ...retained, tensDayShift: ['SYNTHETIC B'] },
    retained.lastUpdated,
    { baseRecord: retained }
  );
  expect(result.savedLocally).toBe(true);
  const final = await hospitalDB.dailyRecords.get(date);
  expect(final?.nursesDayShift).toEqual(['SYNTHETIC A']);
  expect(final?.tensDayShift).toEqual(['SYNTHETIC B']);
  expect((await hospitalDB.syncQueue.toArray())[0].payload).toMatchObject({
    nursesDayShift: ['SYNTHETIC A'],
    tensDayShift: ['SYNTHETIC B'],
  });
});
