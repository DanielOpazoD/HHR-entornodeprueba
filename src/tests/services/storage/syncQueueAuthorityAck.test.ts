import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

const { callable, getDocMock } = vi.hoisted(() => ({
  callable: vi.fn(),
  getDocMock: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: getDocMock,
  setDoc: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: vi.fn(() => ({ id: 'synthetic-doc' })),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'enforced',
  isServerClinicalWriteFenceActive: async () => true,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: callable,
}));

const date = '2026-10-10';
const record = (revision: string, nurses: string[]) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    nursesDayShift: nurses,
    lastUpdated: `${date}T10:00:${revision}.000Z`,
  });
const first = () => record('01', ['Sintetica A']);
const newer = () => record('02', ['Sintetica A', 'Sintetica B']);
const committed = () => record('03', ['Sintetica A autorizada']);
const makeEngine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => false, getOwnerKey: () => null, onOnline: () => {} },
    transport: createFirestoreSyncTransport(),
    batchSize: 1,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });

const beginAck = async () => {
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => {
    started = resolve;
  });
  callable.mockImplementation(() => {
    started();
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const engine = makeEngine();
  await engine.queueDailyRecordTaskWithLocalRecord(
    first(),
    {
      syncContract: { changedPaths: ['nursesDayShift'], mutationId: 'synthetic-mutation-A' },
    },
    { deferProcessing: true }
  );
  const processing = engine.processQueue();
  await startedPromise;
  const [task] = await hospitalDB.syncQueue.toArray();
  return {
    engine,
    processing,
    task,
    finish: (ack: DailyRecord = committed()) =>
      finish({
        recordState: { record: ack, lastUpdated: ack.lastUpdated, meta: {} },
      }),
  };
};

describe('transactional outbox authority ACK', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    callable.mockReset();
    getDocMock.mockReset().mockResolvedValue({ exists: () => false });
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it.each(['PENDING', 'FAILED', 'CONFLICT', 'PROCESSING'] as const)(
    'keeps a later %s projection and task when the older ACK arrives',
    async status => {
      const { engine, processing, finish, task } = await beginAck();
      await engine.queueDailyRecordTaskWithLocalRecord(newer(), undefined, {
        deferProcessing: true,
        holdForMs: 60000,
      });
      const later = (await hospitalDB.syncQueue.toArray()).find(row => row.id !== task.id)!;
      await hospitalDB.syncQueue.update(later.id!, { status });
      const expectedTask = await hospitalDB.syncQueue.get(later.id!);
      finish();
      await processing;

      expect(await hospitalDB.syncQueue.toArray()).toEqual([expectedTask]);
      expect((await hospitalDB.dailyRecords.get(date))?.nursesDayShift).toEqual(
        newer().nursesDayShift
      );
    }
  );

  it('adopts the authoritative record and deletes its own task when no later work exists', async () => {
    const { processing, finish } = await beginAck();
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(committed());
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('does not let a stale claim write the cache or delete a reclaimed task', async () => {
    const { processing, finish, task } = await beginAck();
    await hospitalDB.syncQueue.update(task.id!, {
      leaseOwner: 'another-worker',
      attemptId: 'another-attempt',
      leaseUntil: Date.now() + 60000,
    });
    const reclaimed = await hospitalDB.syncQueue.get(task.id!);
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(first());
    expect(await hospitalDB.syncQueue.toArray()).toEqual([reclaimed]);
  });

  it('does not overwrite an unresolved projection owned by another user', async () => {
    const { engine, processing, finish, task } = await beginAck();
    await engine.queueDailyRecordTaskWithLocalRecord(newer(), undefined, {
      deferProcessing: true,
      holdForMs: 60000,
    });
    const later = (await hospitalDB.syncQueue.toArray()).find(row => row.id !== task.id)!;
    await hospitalDB.syncQueue.update(later.id!, { ownerKey: 'another-user' });
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(newer());
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { id: later.id, ownerKey: 'another-user' },
    ]);
  });

  it('adopts its ACK independently of pending work for another date', async () => {
    const { engine, processing, finish } = await beginAck();
    const other = { ...newer(), date: '2026-10-09' };
    await engine.queueDailyRecordTaskWithLocalRecord(other, undefined, {
      deferProcessing: true,
      holdForMs: 60000,
    });
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(committed());
    expect(await hospitalDB.dailyRecords.get(other.date)).toEqual(other);
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([{ payload: other }]);
  });

  it('quarantines an unqueued local revision instead of overwriting it', async () => {
    const { processing, finish } = await beginAck();
    await hospitalDB.dailyRecords.put(newer());
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(newer());
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { status: 'CONFLICT', lastErrorCategory: 'conflict', payload: first() },
    ]);
  });

  it('does not discard tasks if their unresolved local projection is missing', async () => {
    const { engine, processing, finish } = await beginAck();
    await engine.queueDailyRecordTaskWithLocalRecord(newer(), undefined, {
      deferProcessing: true,
      holdForMs: 60000,
    });
    await hospitalDB.dailyRecords.delete(date);
    finish();
    await processing;

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      status: 'CONFLICT',
      lastErrorCategory: 'conflict',
    });
    expect(tasks[1].payload).toEqual(newer());
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });

  it('refuses an ACK whose claimed task no longer targets the record', async () => {
    const { task, processing, finish } = await beginAck();
    await hospitalDB.syncQueue.update(task.id!, { key: 'daily:2026-10-09' });
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(first());
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { status: 'CONFLICT', lastErrorCategory: 'conflict' },
    ]);
  });

  it('replays B after completing A without losing B or treating A as its confirmation', async () => {
    const { engine, processing, finish, task } = await beginAck();
    await engine.queueDailyRecordTaskWithLocalRecord(newer(), undefined, {
      deferProcessing: true,
      holdForMs: 60000,
    });
    const later = (await hospitalDB.syncQueue.toArray()).find(row => row.id !== task.id)!;
    finish();
    await processing;

    const authorizedB = { ...newer(), lastUpdated: `${date}T10:00:04.000Z` };
    callable.mockReset().mockResolvedValue({
      recordState: { record: authorizedB, lastUpdated: authorizedB.lastUpdated, meta: {} },
    });
    await hospitalDB.syncQueue.update(later.id!, { preOutboxHoldUntil: 0, nextAttemptAt: 0 });
    await engine.processQueue();

    expect(callable).toHaveBeenCalledOnce();
    expect(callable).toHaveBeenCalledWith(expect.objectContaining({ record: newer() }));
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(authorizedB);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('rolls back a failed completion and adopts an already-applied ACK on explicit retry', async () => {
    const { engine, processing, finish } = await beginAck();
    vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
      new Error('Synthetic delete failure')
    );
    finish();
    await processing;

    expect(await hospitalDB.dailyRecords.get(date)).toEqual(first());
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task).toMatchObject({ status: 'FAILED', payload: first() });
    await createDexieSyncQueueStore().requeueQuarantinedTask!(task.id!, null);
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...committed(), meta: { lastMutationId: 'synthetic-mutation-A' } }),
    });
    callable.mockReset().mockRejectedValue(new Error('Must not publish an applied mutation twice'));
    await engine.processQueue();

    expect(callable).not.toHaveBeenCalled();
    expect(await hospitalDB.dailyRecords.get(date)).toMatchObject({
      lastUpdated: committed().lastUpdated,
      nursesDayShift: committed().nursesDayShift,
    });
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
