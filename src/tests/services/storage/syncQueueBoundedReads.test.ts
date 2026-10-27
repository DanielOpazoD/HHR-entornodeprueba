import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const OWNER = 'user:synthetic-bounded-reads';
const NOW = 10_000;
const store = createDexieSyncQueueStore();
const claim = {
  leaseOwner: 'synthetic-worker',
  attemptId: 'synthetic-attempt',
  leaseUntil: 20_000,
};
const makeTask = (timestamp: number, patch: Partial<SyncTask> = {}): SyncTask => ({
  opId: `synthetic:${timestamp}`,
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:synthetic-${timestamp}`,
  ownerKey: OWNER,
  timestamp,
  retryCount: 0,
  status: 'PENDING',
  payload: { syntheticText: 'x'.repeat(4096) },
  ...patch,
});

beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('bounded sync queue reads', () => {
  it('returns the newest eligible page without loading the older backlog into the result', async () => {
    await hospitalDB.syncQueue.bulkAdd([
      ...Array.from({ length: 1000 }, (_, index) => makeTask(index + 1)),
      makeTask(1001, { ownerKey: 'user:another-synthetic-owner' }),
      makeTask(1002, { status: 'RETIRED' }),
    ]);
    const read = vi.fn((task: SyncTask) => task);
    hospitalDB.syncQueue.hook('reading', read);
    try {
      const rows = await store.listRecent(13, OWNER);
      expect(rows.map(task => task.timestamp)).toEqual(
        Array.from({ length: 13 }, (_, index) => 1000 - index)
      );
      expect(read).toHaveBeenCalledTimes(13);
    } finally {
      hospitalDB.syncQueue.hook('reading').unsubscribe(read);
    }
    expect(await hospitalDB.syncQueue.count()).toBe(1002);
  });

  it('keeps legacy ownerless work visible and fills expanded pages past foreign and retired rows', async () => {
    await hospitalDB.syncQueue.bulkAdd([
      makeTask(1, { status: 'FAILED' }),
      makeTask(2, { ownerKey: undefined, status: 'CONFLICT' }),
      makeTask(3, { ownerKey: 'user:another-synthetic-owner' }),
      makeTask(4, { status: 'RETIRED' }),
      makeTask(5, { status: 'PROCESSING' }),
    ]);
    expect((await store.listRecent(2, OWNER)).map(task => task.timestamp)).toEqual([5, 2]);
    expect((await store.listRecent(4, OWNER)).map(task => task.timestamp)).toEqual([5, 2, 1]);
    expect((await store.listRecent(4, null)).map(task => task.timestamp)).toEqual([2]);
    expect(await store.listRecent(0, OWNER)).toEqual([]);
  });

  it('claims only the oldest ready batch without loading the newer backlog into the result', async () => {
    await hospitalDB.syncQueue.bulkAdd(
      Array.from({ length: 1000 }, (_, index) => makeTask(index + 1))
    );
    const read = vi.fn((task: SyncTask) => task);
    hospitalDB.syncQueue.hook('reading', read);
    try {
      const rows = await store.claimReadyPending(NOW, 3, OWNER, claim);
      expect(rows.map(task => task.timestamp)).toEqual([1, 2, 3]);
      expect(
        rows.every(task => task.status === 'PROCESSING' && task.leaseOwner === claim.leaseOwner)
      ).toBe(true);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      hospitalDB.syncQueue.hook('reading').unsubscribe(read);
    }
    expect(await hospitalDB.syncQueue.where('status').equals('PENDING').count()).toBe(997);
    expect(await store.claimReadyPending(NOW, 0, OWNER, claim)).toEqual([]);
  });

  it('fills a batch after held, deferred, foreign, quarantined and live leased work', async () => {
    await hospitalDB.syncQueue.bulkAdd([
      makeTask(1, { preOutboxHoldUntil: NOW + 1 }),
      makeTask(2, { nextAttemptAt: NOW + 1 }),
      makeTask(3, { ownerKey: 'user:another-synthetic-owner' }),
      makeTask(4, { status: 'FAILED' }),
      makeTask(5, { status: 'CONFLICT' }),
      makeTask(6, { status: 'RETIRED' }),
      makeTask(7, { status: 'PROCESSING', leaseUntil: NOW + 1 }),
      makeTask(8, { status: 'PROCESSING', leaseUntil: NOW }),
      makeTask(9, { ownerKey: undefined }),
      makeTask(10),
    ]);
    const before = await hospitalDB.syncQueue.orderBy('timestamp').toArray();
    const [first, second] = await Promise.all([
      store.claimReadyPending(NOW, 2, OWNER, claim),
      store.claimReadyPending(NOW, 2, OWNER, { ...claim, leaseOwner: 'synthetic-second-worker' }),
    ]);
    expect(first.map(task => task.timestamp)).toEqual([8, 9]);
    expect(second.map(task => task.timestamp)).toEqual([10]);
    expect((await hospitalDB.syncQueue.orderBy('timestamp').toArray()).slice(0, 7)).toEqual(
      before.slice(0, 7)
    );
  });

  it.each([0, 20, 1000])('skips %i retired rows without visiting their payloads', async retired => {
    await hospitalDB.syncQueue.bulkAdd([
      ...Array.from({ length: retired }, (_, index) => makeTask(index + 1, { status: 'RETIRED' })),
      ...Array.from({ length: 10 }, (_, index) => makeTask(index + retired + 1)),
    ]);
    let visited = 0;
    const original = IDBIndex.prototype.openCursor;
    vi.spyOn(IDBIndex.prototype, 'openCursor').mockImplementation(function (
      this: IDBIndex,
      ...args
    ) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => {
        if (request.result) visited += 1;
      });
      return request;
    });
    const rows = await store.claimReadyPending(NOW, 3, OWNER, claim);
    expect(rows.map(task => task.timestamp)).toEqual([retired + 1, retired + 2, retired + 3]);
    expect(visited).toBe(3);
    expect(await hospitalDB.syncQueue.where('status').equals('RETIRED').count()).toBe(retired);
  });

  it('merges both ready states by timestamp and primary key before claiming a batch', async () => {
    const expiredId = await hospitalDB.syncQueue.add(
      makeTask(1, { status: 'PROCESSING', leaseUntil: NOW - 1 })
    );
    const pendingId = await hospitalDB.syncQueue.add(makeTask(1));
    await hospitalDB.syncQueue.bulkAdd([
      makeTask(2, { status: 'PROCESSING', leaseUntil: NOW - 1 }),
      makeTask(3),
      makeTask(4, { status: 'PROCESSING', leaseUntil: NOW - 1 }),
      makeTask(5),
    ]);
    const first = await store.claimReadyPending(NOW, 3, OWNER, claim);
    expect(first.map(task => task.timestamp)).toEqual([1, 1, 2]);
    expect(first.slice(0, 2).map(task => task.id)).toEqual([expiredId, pendingId]);
    const next = await store.claimReadyPending(NOW, 3, OWNER, {
      ...claim,
      leaseOwner: 'synthetic-second-worker',
    });
    expect(next.map(task => task.timestamp)).toEqual([3, 4, 5]);
  });
});
