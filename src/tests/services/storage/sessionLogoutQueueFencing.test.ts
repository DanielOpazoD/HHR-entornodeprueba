/* Synthetic only: a closed session's unsent work must stop competing for the day and the queue. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
import { listQuarantinedOperations } from '@/features/rayen-import/components/localSyncPresentation';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  hasSessionCleanupFailed,
  SESSION_OWNER_KEY,
  setSessionCleanupFailed,
} from '@/services/storage/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { createBrowserSyncRuntime } from '@/services/storage/sync/browserSyncRuntime';
import { reviewBlockedDailyRecordTask } from '@/services/storage/sync/dailyRecordTaskRetirement';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { toSyncQueueOperationSnapshot } from '@/services/storage/sync/syncQueueOperationSnapshot';
import type { SyncRuntimePort } from '@/services/storage/sync/syncQueuePorts';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-10-29';
const owner = 'user:synthetic-original';
const nextOwner = 'user:synthetic-next';
const serverDay = DataFactory.createMockDailyRecord(date, {
  beds: {},
  lastUpdated: '2026-10-29T09:00:00.000Z',
  nursesDayShift: ['SYNTHETIC SERVER CONFIRMED'],
});
const unsentDay = DataFactory.createMockDailyRecord(date, {
  beds: {},
  lastUpdated: '2026-10-29T10:00:00.000Z',
  nursesDayShift: ['SYNTHETIC UNSENT EDIT'],
});
const dayWrite = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-unsent-edit',
  ownerKey: owner,
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload: unsentDay,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  syncContract: {
    changedPaths: ['nursesDayShift'],
    expectedVersion: serverDay.lastUpdated,
    mutationId: 'synthetic-unsent-edit',
  },
  ...overrides,
});
const buildEngine = (
  store: ReturnType<typeof createDexieSyncQueueStore>,
  ownerKey: string,
  run: () => Promise<unknown>,
  maxPendingTasks = 100,
  runtime: SyncRuntimePort = {
    isOnline: () => false,
    getOwnerKey: () => ownerKey,
    onOnline: () => {},
  }
) =>
  createSyncQueueEngine({
    store,
    runtime,
    transport: { run },
    batchSize: 10,
    maxPendingTasks,
    maxRetries: 3,
    baseRetryDelayMs: 10,
    maxRetryDelayMs: 100,
  } as Parameters<typeof createSyncQueueEngine>[0]);
/** The queue worker as it runs in the browser, reading the session state from local storage. */
const buildBrowserEngine = (run: () => Promise<unknown>) =>
  buildEngine(createDexieSyncQueueStore(), owner, run, 100, createBrowserSyncRuntime());
const closeSession = () =>
  clearSessionScopedClientState('manual', vi.fn().mockResolvedValue(undefined));

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration('synthetic-generation');
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-generation');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  setSessionCleanupFailed(false);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
});

describe('the queue after a session closes with unsent day work', () => {
  it("cuts off another person's send already being sent when their day is cleared", async () => {
    const claim = {
      leaseOwner: 'synthetic-worker',
      attemptId: 'synthetic-attempt',
      leaseUntil: 9e15,
    };
    await hospitalDB.dailyRecords.put(unsentDay);
    const id = Number(
      await hospitalDB.syncQueue.add(
        dayWrite({ ownerKey: nextOwner, status: 'PROCESSING', ...claim })
      )
    );
    await closeSession();
    const kept = await hospitalDB.syncQueue.get(id);
    const store = createDexieSyncQueueStore();

    expect(kept).toMatchObject({ status: 'FAILED', ownerKey: nextOwner, payload: unsentDay });
    expect(kept?.attemptId).toBeUndefined();
    expect(await store.renewClaim!(id, 9e15 + 1, claim)).toBeNull();
    expect(await store.deleteClaimed(id, claim, { ...unsentDay, lastUpdated: 'synthetic' })).toBe(
      false
    );
    expect(
      await store.deletePendingByKey(
        'UPDATE_DAILY_RECORD',
        `daily:${date}`,
        nextOwner,
        'synthetic-unsent-edit'
      )
    ).toBe(false);
    expect(await hospitalDB.syncQueue.get(id)).toEqual(kept);
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });

  it('does not dispatch a send whose session closed after it was claimed', async () => {
    await hospitalDB.dailyRecords.put(unsentDay);
    const id = Number(await hospitalDB.syncQueue.add(dayWrite({ ownerKey: nextOwner })));
    const store = createDexieSyncQueueStore();
    const claimReady = store.claimReadyPending.bind(store);
    store.claimReadyPending = async (...args) => {
      const claimed = await claimReady(...args);
      if (claimed.length) await closeSession();
      return claimed;
    };
    const run = vi.fn(async () => ({}));

    await buildEngine(store, nextOwner, run).processQueue();

    expect(run).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
      status: 'FAILED',
      payload: unsentDay,
    });
  });

  it('never claims a released send that a tab from an older version requeued', async () => {
    await hospitalDB.syncQueue.add(dayWrite({ projectionReleased: true }));
    const claim = {
      leaseOwner: 'synthetic-worker',
      attemptId: 'synthetic-attempt',
      leaseUntil: 9e15,
    };

    expect(
      await createDexieSyncQueueStore().claimReadyPending(Date.now(), 10, owner, claim)
    ).toEqual([]);
  });

  it("offers the owner its send for review when someone else's session cleared its day", async () => {
    const id = Number(await hospitalDB.syncQueue.add(dayWrite({ ownerKey: nextOwner })));
    await closeSession();
    await reconcileAuthorizedSessionOwner(nextOwner);
    const kept = await hospitalDB.syncQueue.get(id);

    expect(listQuarantinedOperations([toSyncQueueOperationSnapshot(kept!)])).toMatchObject([
      { id, recovery: 'review_base', canRetire: true },
    ]);
    expect(await reviewBlockedDailyRecordTask(id)).toMatchObject({ task: { payload: unsentDay } });
  });

  it.each(['FAILED', 'CONFLICT'] as const)(
    'keeps a %s send without its copy when a new edit is the first thing to touch the day',
    async status => {
      const id = Number(await hospitalDB.syncQueue.add(dayWrite({ status })));
      const before = await hospitalDB.syncQueue.get(id);
      const edited = { ...serverDay, nursesNightShift: ['SYNTHETIC NEW EDIT'] };

      await createDexieSyncQueueStore().saveDailyRecordWithTask(
        edited,
        dayWrite({
          opId: 'synthetic-new-edit',
          payload: edited,
          syncContract: {
            changedPaths: ['nursesNightShift'],
            expectedVersion: serverDay.lastUpdated,
            mutationId: 'synthetic-new-edit',
          },
        })
      );

      expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...before, projectionReleased: true });
      expect(await hospitalDB.syncQueue.count()).toBe(2);
    }
  );

  it('keeps a blocked send without its copy when a whole-day save comes first', async () => {
    const id = Number(await hospitalDB.syncQueue.add(dayWrite({ status: 'FAILED' })));
    const before = await hospitalDB.syncQueue.get(id);
    const engine = buildEngine(createDexieSyncQueueStore(), owner, vi.fn());

    const result = await engine.queueDailyRecordTaskWithLocalRecord(
      { ...serverDay, nursesNightShift: ['SYNTHETIC NEW EDIT'] },
      {
        syncContract: {
          mutationId: 'synthetic-new-edit',
          expectedVersion: serverDay.lastUpdated,
          changedPaths: ['*'],
        },
      },
      { deferProcessing: true }
    );

    expect(result.mode).toBe('created');
    expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...before, projectionReleased: true });
  });

  it('keeps the queue limit when a blocked send without its copy cannot be reused', async () => {
    await hospitalDB.syncQueue.add(dayWrite({ status: 'FAILED' }));
    await hospitalDB.syncQueue.add(
      dayWrite({
        opId: 'synthetic-other-day',
        key: 'daily:2026-10-28',
        payload: { ...serverDay, date: '2026-10-28' },
      })
    );
    const engine = buildEngine(createDexieSyncQueueStore(), owner, vi.fn(), 1);

    const result = await engine.queueDailyRecordTaskWithLocalRecord(
      serverDay,
      { origin: 'direct_queue', syncContract: { mutationId: 'synthetic-new-edit' } },
      { deferProcessing: true }
    );

    expect(result).toMatchObject({ accepted: false, mode: 'rejected_backpressure' });
    expect(await hospitalDB.syncQueue.count()).toBe(2);
  });

  describe("after this document's logout cleanup failed", () => {
    const failCleanup = async () => {
      vi.spyOn(hospitalDB.dailyRecords, 'clear').mockRejectedValueOnce(
        new Error('synthetic failure')
      );
      await expect(closeSession()).rejects.toThrow('Session cleanup failed');
      expect(hasSessionCleanupFailed()).toBe(true);
    };

    it('does not send queued work', async () => {
      const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
      const before = await hospitalDB.syncQueue.get(id);
      await failCleanup();
      const run = vi.fn(async () => ({}));

      await buildBrowserEngine(run).processQueue();

      expect(run).not.toHaveBeenCalled();
      expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
    });

    it('does not send work whose claim was renewed just before the cleanup failed', async () => {
      const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
      const store = createDexieSyncQueueStore();
      const renewClaim = store.renewClaim!.bind(store);
      store.renewClaim = async (...args) => {
        const renewed = await renewClaim(...args);
        await failCleanup();
        return renewed;
      };
      const run = vi.fn(async () => ({}));

      await buildEngine(store, owner, run, 100, createBrowserSyncRuntime()).processQueue();

      expect(run).not.toHaveBeenCalled();
      expect(await hospitalDB.syncQueue.get(id)).toMatchObject({ payload: unsentDay });
    });

    it('does not confirm a send already under way, nor write the day back', async () => {
      const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
      const run = vi.fn(async () => {
        await failCleanup();
        return { authoritativeRecord: { ...unsentDay, lastUpdated: 'synthetic-confirmed' } };
      });

      await buildBrowserEngine(run).processQueue();

      expect(run).toHaveBeenCalledOnce();
      expect(await hospitalDB.syncQueue.get(id)).toMatchObject({ payload: unsentDay });
      expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
    });

    it('stands down even when the browser cannot record the pending cleanup', async () => {
      const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
      const setItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string
      ) {
        if (key === 'hhr_session_cleanup_pending_v1') throw new Error('synthetic quota');
        setItem.call(this, key, value);
      });
      await failCleanup();
      const run = vi.fn(async () => ({}));

      await buildBrowserEngine(run).processQueue();

      expect(run).not.toHaveBeenCalled();
      expect(await hospitalDB.syncQueue.get(id)).toMatchObject({ payload: unsentDay });
    });

    it('stands down when the cleanup for a change of owner fails', async () => {
      await hospitalDB.syncQueue.add(dayWrite());
      vi.spyOn(hospitalDB.dailyRecords, 'clear').mockRejectedValueOnce(
        new Error('synthetic failure')
      );
      await expect(reconcileAuthorizedSessionOwner(nextOwner)).rejects.toThrow();
      const run = vi.fn(async () => ({}));

      await buildBrowserEngine(run).processQueue();

      expect(hasSessionCleanupFailed()).toBe(true);
      expect(run).not.toHaveBeenCalled();
    });

    it('works again, and blocks that work for review, once the cleanup succeeds on retry', async () => {
      const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
      await failCleanup();

      await reconcileAuthorizedSessionOwner(nextOwner);

      expect(hasSessionCleanupFailed()).toBe(false);
      expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
        status: 'FAILED',
        ownerKey: owner,
        payload: unsentDay,
        projectionReleased: true,
      });
    });
  });

  it('does not send from a reloaded document until admission completes the pending cleanup', async () => {
    const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
    localStorage.setItem('hhr_session_cleanup_pending_v1', '1');
    setSessionGeneration(null);
    const run = vi.fn(async () => ({}));

    await buildBrowserEngine(run).processQueue();
    expect(run).not.toHaveBeenCalled();

    await reconcileAuthorizedSessionOwner(owner);
    await buildBrowserEngine(run).processQueue();
    expect(run).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
      status: 'FAILED',
      payload: unsentDay,
      projectionReleased: true,
    });
  });

  it('leaves another tab working when a logout elsewhere was interrupted', async () => {
    localStorage.setItem('hhr_session_cleanup_pending_v1', '1');
    const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
    const run = vi.fn(async () => ({}));

    await buildBrowserEngine(run).processQueue();

    expect(run).toHaveBeenCalledOnce();
    expect(await hospitalDB.syncQueue.get(id)).toBeUndefined();
  });
});
