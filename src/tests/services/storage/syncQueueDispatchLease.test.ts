import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const createEngine = (run: (task: SyncTask) => Promise<void>) =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => true, getOwnerKey: () => null, onOnline: () => undefined },
    transport: { run },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

const seedTasks = async () => {
  for (let index = 1; index <= 2; index += 1) {
    await hospitalDB.syncQueue.add({
      type: 'UPDATE_DAILY_RECORD',
      payload: { date: `2026-09-0${index}` },
      timestamp: index,
      retryCount: 0,
      status: 'PENDING',
      opId: `dispatch-${index}`,
      key: `daily:2026-09-0${index}`,
    });
  }
};

describe('sync queue dispatch ownership', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renews the lease of each unstarted task after a slow preceding transport', async () => {
    let now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await seedTasks();
    const transported: string[] = [];
    const engine = createEngine(async task => {
      expect(task.leaseUntil).toBe(now + 30_000);
      expect((await hospitalDB.syncQueue.get(task.id!))?.leaseUntil).toBe(now + 30_000);
      transported.push(task.opId!);
      now += 31_000;
    });
    await engine.processQueue();
    expect(transported).toEqual(['dispatch-1', 'dispatch-2']);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('does not dispatch the batch tail after another tab reclaimed the expired lease', async () => {
    let now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await seedTasks();
    const transportedA: string[] = [];
    const transportedB: string[] = [];
    const workerB = createEngine(async task => {
      transportedB.push(task.opId!);
    });
    const workerA = createEngine(async task => {
      transportedA.push(task.opId!);
      now += 31_000;
      await workerB.processQueue();
    });
    await workerA.processQueue();
    // The already-running operation retains the existing at-least-once contract;
    // its idempotency and stale completion fence are unchanged. The tail is not replayed.
    expect(transportedA).toEqual(['dispatch-1']);
    expect(transportedB).toEqual(['dispatch-1', 'dispatch-2']);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
