import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getSyncQueueStats, getSyncQueueTelemetry } from '@/services/storage/sync/publicSyncQueue';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const events = vi.hoisted(() => vi.fn());
vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const { HangaRoaDatabase } = await import('@/services/storage/indexeddb/indexedDbDatabase');
  const hospitalDB = new HangaRoaDatabase();
  return { hospitalDB, ensureDbReady: () => hospitalDB.open() };
});
vi.mock('@/services/storage/sync/browserSyncRuntime', async () => {
  const { getStoredSessionOwnerKey } = await import('@/services/storage/sessionOwnerKey');
  return {
    createBrowserSyncRuntime: () => ({
      getOwnerKey: getStoredSessionOwnerKey,
      isOnline: () => false,
      onOnline: () => {},
    }),
  };
});
vi.mock('@/services/storage/sync/firestoreSyncTransport', () => ({
  createFirestoreSyncTransport: () => ({ run: vi.fn() }),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: events,
}));

const NOW = Date.parse('2026-10-29T18:00:00.000Z');
const OWNER_A = 'user:synthetic-owner-a';
const OWNER_B = 'user:synthetic-owner-b';
const OWNERS = [OWNER_A, OWNER_B, undefined, ''];
const task = (id: number, status: SyncTask['status'], ownerKey?: string): SyncTask => ({
  id,
  opId: `synthetic-telemetry-${id}`,
  type: 'UPDATE_DAILY_RECORD',
  ownerKey,
  timestamp: NOW - 6000,
  retryCount: 1,
  status,
  payload: { synthetic: true, preserved: `payload-${id}` },
  ...(status === 'PROCESSING' ? { leaseUntil: NOW + 30000 } : {}),
});
const enter = (owner: string | null) => {
  if (owner === null) localStorage.removeItem(SESSION_OWNER_KEY);
  else localStorage.setItem(SESSION_OWNER_KEY, owner);
  setSessionGeneration('synthetic-telemetry-generation');
};
const putLegacyNullOwner = (record: SyncTask) =>
  new Promise<void>((resolve, reject) => {
    const transaction = hospitalDB.backendDB().transaction('syncQueue', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore('syncQueue').put({ ...record, ownerKey: null });
  });

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic test forbids fetch')));
  if (!hospitalDB.isOpen()) await hospitalDB.open();
  await hospitalDB.syncQueue.clear();
  events.mockClear();
  enter(OWNER_A);
});
afterEach(() => {
  enter(null);
  setSessionGeneration(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  hospitalDB.close();
});

it('preserves every public telemetry field for pending, processing and quarantined sends', async () => {
  const states: SyncTask['status'][] = [
    'PENDING',
    'PENDING',
    'PENDING',
    'PROCESSING',
    'PROCESSING',
    'PROCESSING',
    'FAILED',
    'CONFLICT',
  ];
  await hospitalDB.syncQueue.bulkAdd(
    OWNERS.flatMap((owner, ownerIndex) =>
      states.map(
        (status, index): SyncTask => ({
          ...task(ownerIndex * states.length + index + 1, status, owner),
          timestamp: index % 3 === 0 ? 0 : index % 3 === 1 ? NOW - 6000 : NOW + 6000,
          retryCount: index % 3 === 0 ? 0 : index % 3 === 1 ? 3 : 99,
          origin: index % 3 ? 'direct_queue' : undefined,
        })
      )
    )
  );
  expect(await getSyncQueueTelemetry()).toEqual({
    pending: 18,
    failed: 3,
    conflict: 3,
    retrying: 12,
    orphanedTasks: 8,
    oldestPendingAgeMs: 0,
    oldestDirectQueueAgeMs: 6000,
    batchSize: 25,
    pendingBudgetState: 'ok',
    oldestPendingBudgetState: 'ok',
    directQueueBudgetState: 'ok',
    retryingBudgetState: 'critical',
    runtimeState: 'blocked',
    ownerKey: OWNER_A,
    readState: 'ok',
  });
  expect(await getSyncQueueStats()).toEqual({ pending: 18, failed: 3, conflict: 3 });
});

it.each<[string | null, number, number, number, number]>([
  [OWNER_A, 8, 4, 4, 4],
  [OWNER_B, 8, 4, 4, 4],
  [null, 6, 3, 3, 8],
  ['', 6, 3, 3, 8],
])(
  'keeps the legacy owner partition for session %s',
  async (owner, pending, failed, conflict, foreign) => {
    const states: SyncTask['status'][] = ['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT', 'RETIRED'];
    await hospitalDB.syncQueue.bulkAdd(
      OWNERS.flatMap((value, ownerIndex) =>
        states.map((status, index) => task(ownerIndex * states.length + index + 1, status, value))
      )
    );
    for (const [index, status] of states.entries())
      await putLegacyNullOwner(task(100 + index, status));
    const before = await hospitalDB.syncQueue.toArray();
    enter(owner);
    expect(await getSyncQueueTelemetry()).toMatchObject({
      pending,
      failed,
      conflict,
      orphanedTasks: foreign,
      retrying: pending,
      oldestPendingAgeMs: 6000,
      readState: 'ok',
      ownerKey: owner,
    });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
  }
);

it('never returns a partial success if reading a later row fails, then recovers', async () => {
  await hospitalDB.syncQueue.bulkAdd([
    task(1, 'PENDING', OWNER_A),
    task(2, 'PROCESSING', OWNER_A),
    task(3, 'FAILED', OWNER_B),
  ]);
  const failLater = (row: SyncTask) => {
    if (row.id === 2) throw new Error('Synthetic later-row read failure');
    return row;
  };
  hospitalDB.syncQueue.hook('reading', failLater);
  try {
    expect(await getSyncQueueTelemetry()).toMatchObject({
      pending: 0,
      failed: 0,
      conflict: 0,
      orphanedTasks: 0,
      readState: 'unavailable',
      runtimeState: 'blocked',
    });
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'sync_queue_telemetry_unavailable',
        runtimeState: 'blocked',
      })
    );
  } finally {
    hospitalDB.syncQueue.hook('reading').unsubscribe(failLater);
  }
  expect(await getSyncQueueTelemetry()).toMatchObject({
    pending: 2,
    failed: 0,
    conflict: 0,
    orphanedTasks: 1,
    readState: 'ok',
  });
  expect(await hospitalDB.syncQueue.count()).toBe(3);
});

it('reports no live sends for a table containing only retained backups', async () => {
  await hospitalDB.syncQueue.bulkAdd([task(1, 'RETIRED', OWNER_A), task(2, 'RETIRED', OWNER_B)]);
  expect(await getSyncQueueTelemetry()).toMatchObject({
    pending: 0,
    failed: 0,
    conflict: 0,
    orphanedTasks: 0,
    readState: 'ok',
  });
  expect(await hospitalDB.syncQueue.count()).toBe(2);
});
