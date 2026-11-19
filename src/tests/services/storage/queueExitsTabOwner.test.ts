import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { getSessionOwner } from '@/services/storage/sessionStorageTransition';
import { isSessionCleanupPending } from '@/services/storage/sessionOwnerKey';
import {
  captureAuthoringSession,
  guardAuthoringSession,
} from '@/services/storage/authoringSession';
import {
  discardQuarantinedSyncTask,
  ensureSyncQueueOnlineListener,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
  retryQuarantinedSyncTask,
} from '@/services/storage/sync/publicSyncQueue';
import { persistCudyrArchivePart } from '@/services/cudyr/cudyrArchiveQueue';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { replaceStoredSessionOwner } from '@/tests/utils/syntheticSession';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';

const port = vi.hoisted(() => ({ ready: vi.fn(), sent: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', async original => ({
  ...(await original<object>()),
  ensureDbReady: port.ready,
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    getCurrentUser: () => ({
      uid: 'synthetic-a',
      getIdTokenResult: async () => ({ claims: { role: 'nurse_hospital' } }),
    }),
  },
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<object>()),
  getRecordDocRef: () => ({}),
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<object>()),
  getDoc: async () => ({
    exists: () => true,
    data: () => ({ rayenSync: { runId: 'synthetic-authority' } }),
  }),
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: async () => ({}) },
}));
// The transport records whose archive leaves and whom this tab admitted at that moment.
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (request: { capture: { id: string } }) => {
    port.sent(request.capture.id, getSessionOwner());
    return {
      data: { success: true, persisted: true, captureReceiptId: 'synthetic-ack', results: [] },
    };
  },
}));

const A = 'user:synthetic-a';
const B = 'user:synthetic-b';

const capture = (id: string): ArchiveCudyrHistoryRequest => ({
  schemaVersion: 1,
  runId: 'synthetic-run',
  authorityDate: '2026-11-18',
  evaluations: [],
  capture: {
    id,
    clinicalEpisodeId: 'synthetic-episode',
    sourceRunId: 'synthetic-run',
    observedAt: '2026-11-18T12:00:00Z',
    status: 'observed',
    metadataStatus: 'complete',
    part: 0,
    totalParts: 1,
    totalEvaluations: 0,
  },
});

const archiveTask = (ownerKey: string, status: SyncTask['status']): SyncTask => ({
  opId: `archive-${ownerKey}-${status}`,
  ownerKey,
  type: 'ARCHIVE_CUDYR',
  status,
  timestamp: Date.now() - 600_000,
  retryCount: 3,
  error: status === 'PENDING' ? undefined : 'synthetic failure',
  payload: { id: `archive-${ownerKey}`, request: capture(`archive-${ownerKey}`) },
});

/**
 * Another tab of this browser signs B in: the shared owner key becomes B while this document keeps
 * A admitted in memory (a module reset would make this tab's lazy imports load the other tab's).
 */
const otherTabAdmitsB = async () => replaceStoredSessionOwner(B);

const goOnline = () => {
  ensureSyncQueueOnlineListener();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  window.dispatchEvent(new Event('online'));
};

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  localStorage.clear();
  await hospitalDB.syncQueue.clear();
  port.sent.mockClear();
  port.ready.mockReset().mockResolvedValue(undefined);
  await reconcileAuthorizedSessionOwner(A);
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});

describe('every queue exit acts only for the person this tab admitted', () => {
  it('enqueue: A’s capture interrupted by B is never queued nor sent in B’s name', async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => (entered = resolve));
    const held = new Promise<void>(resolve => (release = resolve));
    // The run's own readiness passes; the queue's wait is where B signs in.
    port.ready.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      entered();
      await held;
    });
    const run = persistCudyrArchivePart(
      capture('capture-of-a'),
      new AbortController().signal,
      guardAuthoringSession()
    ).catch((error: Error) => error.message);
    await waiting;
    await reconcileAuthorizedSessionOwner(B);
    release();
    await run;
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    expect(port.sent).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'CONFLICT'] as const)(
    'retry and discard: a tab still admitted as A leaves B’s %s task intact',
    async status => {
      await otherTabAdmitsB();
      const id = await hospitalDB.syncQueue.add(archiveTask(B, status));
      const before = await hospitalDB.syncQueue.get(id);
      expect(await retryQuarantinedSyncTask(id)).toBe(false);
      expect(await discardQuarantinedSyncTask(id)).toBe(false);
      expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
    }
  );

  it('retry and discard: A still acts on A’s own tasks', async () => {
    const retried = await hospitalDB.syncQueue.add(archiveTask(A, 'FAILED'));
    const discarded = await hospitalDB.syncQueue.add(archiveTask(A, 'CONFLICT'));
    expect(await retryQuarantinedSyncTask(retried)).toBe(true);
    expect((await hospitalDB.syncQueue.get(retried))?.status).toBe('PENDING');
    expect(await discardQuarantinedSyncTask(discarded)).toBe(true);
    expect(await hospitalDB.syncQueue.get(discarded)).toBeUndefined();
  });

  it('retry: a logout that begins while the row is read leaves it exactly as it was', async () => {
    const id = await hospitalDB.syncQueue.add(archiveTask(A, 'FAILED'));
    const before = await hospitalDB.syncQueue.get(id);
    const read = hospitalDB.syncQueue.get.bind(hospitalDB.syncQueue);
    let logout!: Promise<void>;
    let started!: () => void;
    let finish!: () => void;
    const begun = new Promise<void>(resolve => (started = resolve));
    const hold = new Promise<void>(resolve => (finish = resolve));
    // A real IndexedDB read; the logout begins while it is outstanding.
    const readDuringLogout = (key: number) => {
      const row = read(key);
      Dexie.ignoreTransaction(() => {
        logout = clearSessionScopedClientState('automatic', async () => {
          started();
          await hold;
        });
      });
      return Dexie.waitFor(Promise.all([row, begun])).then(([data]) => {
        expect(isSessionCleanupPending()).toBe(true);
        return data;
      });
    };
    vi.spyOn(hospitalDB.syncQueue, 'get').mockImplementationOnce(readDuringLogout as never);
    let applied: boolean;
    try {
      applied = await retryQuarantinedSyncTask(id);
    } finally {
      finish();
      await logout;
    }
    expect({ applied, after: await hospitalDB.syncQueue.get(id) }).toEqual({
      applied: false,
      after: before,
    });
  });

  it('processing: on reconnect, a tab still admitted as A leaves B’s pending archive unsent', async () => {
    await otherTabAdmitsB();
    const id = await hospitalDB.syncQueue.add(archiveTask(B, 'PENDING'));
    const before = await hospitalDB.syncQueue.get(id);
    goOnline();
    // Any save of A's in this tab also asks to process: the processor itself must skip B's task.
    await processSyncQueue();
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(port.sent).not.toHaveBeenCalled();
    // Not even claimed or marked: B's task is exactly as B left it.
    expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
  });

  it('processing: on reconnect, A’s own pending archive leaves once in A’s name', async () => {
    const id = await hospitalDB.syncQueue.add(archiveTask(A, 'PENDING'));
    goOnline();
    await vi.waitFor(async () => expect(await hospitalDB.syncQueue.get(id)).toBeUndefined());
    expect(port.sent.mock.calls).toEqual([[`archive-${A}`, A]]);
  });

  it('enqueue: an edit A makes in a census still open after B signed in elsewhere stays A’s', async () => {
    await otherTabAdmitsB();
    const day = DataFactory.createMockDailyRecord('2026-11-18');
    const result = await queueDailyRecordSyncTaskWithLocalRecord(
      day,
      { contexts: ['clinical'] },
      { authoringSession: captureAuthoringSession(), deferProcessing: true }
    );
    expect(result.mode).toBe('retained_for_owner');
    const rows = await hospitalDB.syncQueue.toArray();
    // Kept for A to review on return; B's queue never holds it, so B neither sees nor revives it.
    expect(rows.map(row => row.ownerKey)).toEqual([A]);
  });

  it('claim: a pass begun before A logged out claims nothing once B holds the browser', async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => (entered = resolve));
    const held = new Promise<void>(resolve => (release = resolve));
    port.ready.mockImplementationOnce(async () => {
      entered();
      await held;
    });
    const pass = processSyncQueue();
    await waiting;
    await clearSessionScopedClientState('automatic');
    await otherTabAdmitsB();
    const id = await hospitalDB.syncQueue.add(archiveTask(B, 'PENDING'));
    const before = await hospitalDB.syncQueue.get(id);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    release();
    await pass;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(port.sent).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
  });

  it('claim: each task is asked inside the claim, so a change during it takes nothing', async () => {
    const id = await hospitalDB.syncQueue.add(archiveTask(A, 'PENDING'));
    const before = await hospitalDB.syncQueue.get(id);
    const where = hospitalDB.syncQueue.where.bind(hospitalDB.syncQueue);
    // B signs in elsewhere exactly while this tab's claim reads the ready tasks.
    vi.spyOn(hospitalDB.syncQueue, 'where').mockImplementation(((index: string) => {
      if (index === '[status+timestamp]') replaceStoredSessionOwner(B);
      return where(index);
    }) as never);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();
    vi.restoreAllMocks();
    expect(port.sent).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
  });
});
