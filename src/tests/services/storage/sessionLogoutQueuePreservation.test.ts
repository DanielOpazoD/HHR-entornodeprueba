import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { requeueQuarantinedTask } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import { getDiscardedDailyRecordBackup } from '@/services/storage/sync/dailyRecordTaskRetirement';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
const owner = 'user:synthetic-doctor';
const createTask = (opId: string, overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId,
  ownerKey: owner,
  type: 'UPDATE_DAILY_RECORD',
  key: 'daily:2026-10-22',
  payload: { date: '2026-10-22', beds: {}, nurses: ['SYNTHETIC PENDING'] },
  timestamp: 1,
  retryCount: 2,
  status: 'PENDING',
  syncContract: {
    expectedVersion: 'synthetic-original-base',
    changedPaths: ['nurses'],
    mutationId: opId,
  },
  ...overrides,
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration('synthetic-logout-generation');
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-logout-generation');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
});

it.each(['manual', 'automatic'] as const)(
  'preserves non-nursing pending sends and backups through %s logout, isolated from the next account',
  async reason => {
    const rows = [
      createTask('pending'),
      createTask('processing', {
        status: 'PROCESSING',
        leaseOwner: 'old-worker',
        attemptId: 'old-attempt',
        leaseUntil: 20_000,
      }),
      createTask('refused', {
        status: 'FAILED',
        error: 'base_required: synthetic original refusal',
        lastErrorCategory: 'validation',
        lastErrorCode: 'functions/failed-precondition',
      }),
      createTask('conflict', {
        status: 'CONFLICT',
        error: 'synthetic episode conflict',
        lastErrorCategory: 'conflict',
      }),
      createTask('backup', {
        status: 'RETIRED',
        error: 'synthetic original rejection',
        retirement: {
          reason: 'manual_discard',
          previousStatus: 'FAILED',
          retiredAt: '2026-10-22T12:00:00.000Z',
        },
      }),
    ];
    await hospitalDB.syncQueue.bulkAdd(rows);
    const before = await hospitalDB.syncQueue.toArray();
    const foreign = createTask('foreign', { ownerKey: 'user:next-account' });
    await hospitalDB.syncQueue.add(foreign);
    await hospitalDB.syncQueue.add(createTask('unattributed', { ownerKey: undefined }));
    await hospitalDB.dailyRecords.put(DataFactory.createMockDailyRecord('2026-10-22'));
    localStorage.setItem('hhr_private', 'synthetic-private-cache');
    sessionStorage.setItem('hhr_private', 'synthetic-private-session');
    const signOut = vi.fn().mockResolvedValue(undefined);
    await clearSessionScopedClientState(reason, signOut);
    expect(signOut).toHaveBeenCalledOnce();
    expect(await hospitalDB.dailyRecords.count()).toBe(0);
    expect(localStorage.getItem('hhr_private')).toBeNull();
    expect(sessionStorage.getItem('hhr_private')).toBeNull();
    expect(localStorage.getItem(SESSION_OWNER_KEY)).toBeNull();
    expect(await hospitalDB.syncQueue.count()).toBe(7);
    const store = createDexieSyncQueueStore();
    const original = (opId: string) => {
      const row = before.find(task => task.opId === opId);
      if (row?.id === undefined) throw new Error('Expected the original persisted task');
      return { ...row, id: row.id };
    };
    for (const previous of before) {
      if (previous.id === undefined) throw new Error('Expected a persisted task id');
      const saved = await hospitalDB.syncQueue.get(previous.id);
      if (previous.status === 'PENDING' || previous.status === 'PROCESSING') {
        expect(saved).toMatchObject({
          payload: previous.payload,
          ownerKey: owner,
          syncContract: previous.syncContract,
          status: 'FAILED',
          lastErrorCode: 'session_owner_logged_out',
          localProjection: 'released',
        });
        expect(saved?.leaseOwner).toBeUndefined();
        expect(saved?.attemptId).toBeUndefined();
      } else if (previous.status === 'RETIRED') expect(saved).toEqual(previous);
      // Blocked sends keep their status and diagnosis; only the cleared day stops being theirs.
      else expect(saved).toEqual({ ...previous, localProjection: 'released' });
    }
    const processing = original('processing');
    expect(
      await store.deleteClaimed(processing.id, {
        leaseOwner: 'old-worker',
        attemptId: 'old-attempt',
        leaseUntil: 20_000,
      })
    ).toBe(false);
    expect(await hospitalDB.syncQueue.get(processing.id)).toMatchObject({
      status: 'FAILED',
      payload: processing.payload,
    });
    expect(await store.listAll('user:next-account')).toEqual([expect.objectContaining(foreign)]);
    await reconcileAuthorizedSessionOwner('user:next-account');
    expect(await store.listAll('user:next-account')).toEqual([expect.objectContaining(foreign)]);
    const owned = original('pending');
    expect(await requeueQuarantinedTask(owned.id, 'user:next-account')).toBe(false);
    await reconcileAuthorizedSessionOwner(owner);
    const refused = original('refused');
    expect(await requeueQuarantinedTask(refused.id, owner)).toBe(false);
    const backup = original('backup');
    const serialized = await getDiscardedDailyRecordBackup(backup.id);
    if (!serialized) throw new Error('Expected the preserved downloadable backup');
    expect(JSON.parse(serialized)).toMatchObject({
      remotelyConfirmed: false,
      task: backup,
    });
  }
);

it('does not silently adopt or delete unattributed work when the previous owner is unknown', async () => {
  localStorage.removeItem(SESSION_OWNER_KEY);
  const own = await hospitalDB.syncQueue.add(createTask('owned'));
  const orphan = await hospitalDB.syncQueue.add(
    createTask('legacy', {
      ownerKey: undefined,
      status: 'CONFLICT',
      error: 'synthetic original conflict',
    })
  );
  await clearSessionScopedClientState('automatic');
  expect(await hospitalDB.syncQueue.get(own)).toMatchObject({ ownerKey: owner, status: 'PENDING' });
  expect(await hospitalDB.syncQueue.get(orphan)).toMatchObject({
    ownerKey: 'unattributed:legacy',
    status: 'CONFLICT',
    error: 'synthetic original conflict',
  });
  expect(await createDexieSyncQueueStore().listAll('user:next-account')).toEqual([]);
});

it('keeps the queue and blocks admission if preservation fails, then retries without dropping work', async () => {
  const pending = createTask('transaction-failure');
  const id = await hospitalDB.syncQueue.add(pending);
  const failure = vi
    .spyOn(hospitalDB.syncQueue, 'update')
    .mockRejectedValueOnce(new Error('synthetic queue store failure'));
  const signOut = vi.fn().mockResolvedValue(undefined);
  await expect(clearSessionScopedClientState('manual', signOut)).rejects.toThrow(
    'Session cleanup failed'
  );
  expect(signOut).toHaveBeenCalledOnce();
  expect(localStorage.getItem(SESSION_OWNER_KEY)).toBe(owner);
  expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...pending, id });
  failure.mockRestore();
  await reconcileAuthorizedSessionOwner('user:next-account');
  expect(localStorage.getItem(SESSION_OWNER_KEY)).toBe('user:next-account');
  expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
    ownerKey: owner,
    payload: pending.payload,
    status: 'FAILED',
  });
  expect(await createDexieSyncQueueStore().listAll('user:next-account')).toEqual([]);
});
