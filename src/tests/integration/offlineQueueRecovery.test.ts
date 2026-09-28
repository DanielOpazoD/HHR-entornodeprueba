import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { DataFactory } from '@/tests/factories/DataFactory';

// Real queue engine, transaction store and policies; only the browser IndexedDB implementation
// and remote transport are substitutes. Reopening the connection is not a browser reload test.
const DATE = '2026-09-27';
const OWNER = 'synthetic-owner-a';
const makeRecord = () =>
  DataFactory.createMockDailyRecord(DATE, {
    lastUpdated: '2026-09-27T22:00:00.000Z',
    nursesDayShift: ['Synthetic nurse', ''],
  });

const createEngine = (
  run: (task: SyncTask) => Promise<void>,
  { online = false, owner = OWNER } = {}
) =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => online, getOwnerKey: () => owner, onOnline: () => undefined },
    transport: { run },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

const reopenDatabase = async () => {
  hospitalDB.close();
  await hospitalDB.open();
};

describe('Offline queue recovery through persisted IndexedDB state', () => {
  beforeEach(async () => {
    await hospitalDB.open();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await hospitalDB.open();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it('reopens an offline record and its task, then removes the task only after acknowledgement', async () => {
    const record = makeRecord();
    const offlineTransport = vi.fn(async (_task: SyncTask) => undefined);
    const queued = await createEngine(offlineTransport).queueDailyRecordTaskWithLocalRecord(record);
    expect(queued).toMatchObject({ accepted: true, mode: 'created' });
    expect(offlineTransport).not.toHaveBeenCalled();
    const [original] = await hospitalDB.syncQueue.toArray();
    expect(original.syncContract?.mutationId).toEqual(expect.any(String));

    await reopenDatabase();
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([original]);

    let acknowledge!: () => void;
    let markStarted!: () => void;
    const acknowledgement = new Promise<void>(resolve => {
      acknowledge = resolve;
    });
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const transport = vi.fn(async (task: SyncTask) => {
      markStarted();
      expect(task.payload).toEqual(record);
      expect(task.syncContract).toEqual(original.syncContract);
      expect(await hospitalDB.syncQueue.get(task.id!)).toMatchObject({ status: 'PROCESSING' });
      await acknowledgement;
    });
    const processing = createEngine(transport, { online: true }).processQueue();
    try {
      await started;
      expect(await hospitalDB.syncQueue.get(original.id!)).toMatchObject({ status: 'PROCESSING' });
      await createEngine(transport, { online: true }).processQueue();
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      acknowledge();
      await processing;
    }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);

    await reopenDatabase();
    await createEngine(transport, { online: true }).processQueue();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('preserves retry timing and mutation identity across a connection reopen after transport failure', async () => {
    let now = Date.parse('2026-09-27T22:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const record = makeRecord();
    const transport = vi.fn(async (_task: SyncTask) => undefined);
    transport.mockRejectedValueOnce(
      Object.assign(new Error('Unavailable'), { code: 'unavailable' })
    );
    await createEngine(transport).queueDailyRecordTaskWithLocalRecord(record);
    const [original] = await hospitalDB.syncQueue.toArray();
    await createEngine(transport, { online: true }).processQueue();

    const [pending] = await hospitalDB.syncQueue.toArray();
    expect(pending).toMatchObject({ status: 'PENDING', retryCount: 1 });
    expect(pending.nextAttemptAt).toBeGreaterThan(now);
    expect(pending.syncContract).toEqual(original.syncContract);
    await reopenDatabase();
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);
    const recovered = createEngine(transport, { online: true });
    await recovered.processQueue();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.syncQueue.get(pending.id!)).toEqual(pending);

    now = pending.nextAttemptAt!;
    await recovered.processQueue();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0].syncContract).toEqual(original.syncContract);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('does not dispatch another owner’s persisted task after recreating the engine', async () => {
    const record = makeRecord();
    const transport = vi.fn(async (_task: SyncTask) => undefined);
    await createEngine(transport).queueDailyRecordTaskWithLocalRecord(record);
    const [original] = await hospitalDB.syncQueue.toArray();
    await reopenDatabase();

    await createEngine(transport, { online: true, owner: 'synthetic-owner-b' }).processQueue();
    expect(transport).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([original]);
    await createEngine(transport, { online: true }).processQueue();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('rolls back the record when IndexedDB cannot persist its outbox task', async () => {
    const original = makeRecord();
    await hospitalDB.dailyRecords.put(original);
    const edited = { ...original, nursesDayShift: ['New synthetic nurse', ''] };
    const task: SyncTask = {
      opId: 'synthetic-uncloneable-outbox-task',
      type: 'UPDATE_DAILY_RECORD',
      // IndexedDB rejects functions with DataCloneError after the record put has run.
      payload: { invalidClone: () => undefined },
      status: 'PENDING',
      timestamp: Date.parse(original.lastUpdated),
      retryCount: 0,
      ownerKey: OWNER,
      key: `daily:${DATE}`,
    };
    await expect(
      createDexieSyncQueueStore().saveDailyRecordWithTask(edited, task)
    ).rejects.toMatchObject({ name: 'DataCloneError' });

    await reopenDatabase();
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(original);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
