import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import {
  getSyncQueueDomainMetrics,
  getSyncQueueStats,
  getSyncQueueTelemetry,
  listRecentSyncQueueOperations,
} from '@/services/storage/sync';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const OWNER_A = 'user:synthetic-reader-a';
const OWNER_B = 'user:synthetic-reader-b';
const taskA: SyncTask = {
  opId: 'synthetic-reader-a',
  type: 'UPDATE_DAILY_RECORD',
  key: 'daily:2026-10-20',
  ownerKey: OWNER_A,
  timestamp: 1,
  retryCount: 0,
  status: 'FAILED',
  contexts: ['clinical'],
  payload: { date: '2026-10-20', synthetic: true },
};
const taskB: SyncTask = {
  ...taskA,
  opId: 'synthetic-reader-b',
  key: 'daily:2026-10-21',
  ownerKey: OWNER_B,
  timestamp: 2,
  status: 'PENDING',
  contexts: ['staffing'],
  payload: { date: '2026-10-21', synthetic: true },
};
const enter = (owner: string | null, generation: string | null) => {
  if (owner) localStorage.setItem(SESSION_OWNER_KEY, owner);
  else localStorage.removeItem(SESSION_OWNER_KEY);
  setSessionGeneration(generation);
};

const duringRead = async <T>(change: () => void, read: () => Promise<T>): Promise<T> => {
  let changed = false;
  const hook = (task: SyncTask) => {
    if (!changed) {
      changed = true;
      change();
    }
    return task;
  };
  hospitalDB.syncQueue.hook('reading', hook);
  try {
    const result = await read();
    expect(changed).toBe(true);
    return result;
  } finally {
    hospitalDB.syncQueue.hook('reading').unsubscribe(hook);
  }
};

beforeEach(async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.syncQueue.bulkAdd([taskA, taskB]);
  enter(OWNER_A, 'synthetic-session-a');
});
afterEach(() => {
  enter(null, null);
  vi.restoreAllMocks();
});

describe('sync queue reads across session changes', () => {
  it.each([
    ['another owner', OWNER_B, 'synthetic-session-b'],
    ['logout', null, null],
    ['a new session of the same owner', OWNER_A, 'synthetic-session-a-new'],
  ])('does not label old telemetry as current after %s', async (_, owner, generation) => {
    const telemetry = await duringRead(() => enter(owner, generation), getSyncQueueTelemetry);
    expect(telemetry.readState).toBe('unavailable');
    expect(telemetry.failed).toBe(0);
    expect(telemetry.ownerKey).toBe(owner);
    expect(await hospitalDB.syncQueue.count()).toBe(2);
    expect((await getSyncQueueTelemetry()).readState).toBe('ok');
  });

  it.each([
    [OWNER_B, 'synthetic-session-b'],
    [OWNER_A, 'synthetic-session-a-new'],
  ])(
    'rejects the old operations page when its session changes to %s',
    async (owner, generation) => {
      await expect(
        duringRead(
          () => enter(owner, generation),
          () => listRecentSyncQueueOperations(5)
        )
      ).rejects.toThrow('sesión');
      const operations = await listRecentSyncQueueOperations(5);
      expect(operations.map(task => task.key)).toEqual([owner === OWNER_A ? taskA.key : taskB.key]);
    }
  );

  it('does not publish previous-owner stats after a switch during the read', async () => {
    const stats = await duringRead(() => enter(OWNER_B, 'synthetic-session-b'), getSyncQueueStats);
    expect(stats).toEqual({ pending: 0, failed: 0, conflict: 0 });
    expect(await getSyncQueueStats()).toEqual({ pending: 1, failed: 0, conflict: 0 });
  });

  it('does not publish previous-owner domain metrics after a switch during the read', async () => {
    const metrics = await duringRead(
      () => enter(OWNER_B, 'synthetic-session-b'),
      getSyncQueueDomainMetrics
    );
    expect(metrics.byContext.clinical.failed).toBe(0);
    expect((await getSyncQueueDomainMetrics()).byContext.staffing.pending).toBe(1);
  });
});
