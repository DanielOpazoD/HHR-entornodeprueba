import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const date = '2026-10-24';
const publishedBase = '2026-10-24T10:00:00.000Z';
const baseRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: publishedBase,
    nursesDayShift: ['SINTETICA BASE'],
    tensDayShift: ['SINTETICO BASE'],
  });
const localRecord = async (): Promise<DailyRecord> => {
  const record = await hospitalDB.dailyRecords.get(date);
  if (!record) throw new Error('missing synthetic local record');
  return record;
};
const onlyTask = async () => {
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks).toHaveLength(1);
  return tasks[0];
};

describe('the outbox publishes pending work against the remote version it was built on', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
    await hospitalDB.dailyRecords.put(baseRecord());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a second edit made from the local copy keeps the first edit base', async () => {
    await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA A'] },
      { baseRecord: baseRecord() }
    );
    vi.setSystemTime(new Date('2026-10-24T13:00:00.000Z'));
    await updatePartialDetailed(
      date,
      { tensDayShift: ['SINTETICO B'] },
      { baseRecord: await localRecord() }
    );

    const task = await onlyTask();
    expect(task.payload).toMatchObject({
      nursesDayShift: ['SINTETICA A'],
      tensDayShift: ['SINTETICO B'],
    });
    expect(task.syncContract?.expectedVersion).toBe(publishedBase);
  });

  it('a whole-day save over a pending edit keeps that edit base', async () => {
    await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA A'] },
      { baseRecord: baseRecord() }
    );
    vi.setSystemTime(new Date('2026-10-24T13:00:00.000Z'));
    const local = await localRecord();
    await saveDetailed({ ...local, tensDayShift: ['SINTETICO B'] }, local.lastUpdated);

    const task = await onlyTask();
    expect(task.payload).toMatchObject({
      nursesDayShift: ['SINTETICA A'],
      tensDayShift: ['SINTETICO B'],
    });
    expect(task.syncContract?.expectedVersion).toBe(publishedBase);
  });

  it('a fresh edit over a conflicted edit keeps the base the conflict was found on', async () => {
    await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA A'] },
      { baseRecord: baseRecord() }
    );
    const conflicted = await onlyTask();
    await hospitalDB.syncQueue.update(conflicted.id!, { status: 'CONFLICT' });
    vi.setSystemTime(new Date('2026-10-24T13:00:00.000Z'));
    await updatePartialDetailed(
      date,
      { tensDayShift: ['SINTETICO B'] },
      { baseRecord: await localRecord() }
    );

    const task = await onlyTask();
    expect(task.status).toBe('PENDING');
    expect(task.syncContract?.expectedVersion).toBe(publishedBase);
  });
});
