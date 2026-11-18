// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { recoverCudyrArchivesAfterClinicalSync } from '@/features/rayen-import/hooks/recoverCudyrArchivesAfterClinicalSync';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
import { SESSION_GENERATION_KEY } from '@/services/storage/sessionStorageTransition';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { SESSION_CLEANUP_PENDING_KEY, SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { requeueQuarantinedTask } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const port = vi.hoisted(() => ({ ready: vi.fn(), process: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', async original => ({
  ...(await original<object>()),
  ensureDbReady: port.ready,
}));
vi.mock('@/services/storage/sync/publicSyncQueue', () => ({ processSyncQueue: port.process }));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/storage/sync', () => ({ recordSyncQueueOwnershipTelemetry: vi.fn() }));
vi.mock('firebase/firestore', async original => ({
  ...(await original<object>()),
  getDocFromServer: async () => ({ exists: () => false }),
}));
vi.mock('@/services/storage/firestore/firestoreShared', () => ({ getRecordDocRef: () => ({}) }));

const A = 'user:synthetic-a';
const B = 'user:synthetic-b';

/** A CUDYR archive the server refused under the former policy: the recovery's only candidate. */
const blockedArchive = (ownerKey: string): SyncTask => ({
  opId: `archive-${ownerKey}`,
  ownerKey,
  type: 'ARCHIVE_CUDYR',
  status: 'FAILED',
  timestamp: 1,
  retryCount: 1,
  lastErrorCode: 'functions/failed-precondition',
  error: 'Clinical enrichment is not authorized by the current global policy.',
  payload: {
    id: 'archive-synthetic',
    request: {
      schemaVersion: 1,
      authorityDate: '2026-10-09',
      runId: 'synthetic-run',
      evaluations: [],
      capture: {
        id: '00000000-0000-4000-8000-000000000001',
        clinicalEpisodeId: 'synthetic-episode',
        sourceRunId: 'synthetic-run',
        observedAt: '2026-10-09T12:00:00Z',
        status: 'observed',
        metadataStatus: 'complete',
        part: 0,
        totalParts: 1,
        totalEvaluations: 0,
      },
    },
  },
});

const enforced = () => ({
  status: 'ready' as const,
  policy: { mode: 'preview' as const, clinicalBatchMode: 'enforced' as const, revision: 3 },
});

/**
 * A's sync run captures its session, then waits on IndexedDB; `during` runs inside that wait.
 * Returns the archive row afterwards and whether the queue was asked to process.
 */
const runRecoveryAcross = async (rowOwner: string, during: () => Promise<void>) => {
  const id = await hospitalDB.syncQueue.add(blockedArchive(rowOwner));
  let resume!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => (resume = resolve));
  const waiting = new Promise<void>(resolve => (entered = resolve));
  port.ready.mockImplementationOnce(async () => {
    entered();
    await held;
  });
  const run = recoverCudyrArchivesAfterClinicalSync(
    { status: 'complete' },
    enforced,
    3,
    guardAuthoringSession()
  );
  await waiting;
  await during();
  resume();
  await run;
  const row = await hospitalDB.syncQueue.get(id);
  return { owner: row?.ownerKey, status: row?.status, processed: port.process.mock.calls.length };
};

/** Another tab of this browser signs a person in; this document keeps its own admission. */
const otherTabAdmits = async (owner: string) => {
  vi.resetModules();
  const otherTab = await import('@/services/storage/sessionScopedStorageService');
  await otherTab.reconcileAuthorizedSessionOwner(owner);
};

beforeEach(async () => {
  localStorage.clear();
  await hospitalDB.syncQueue.clear();
  port.process.mockReset();
  port.ready.mockReset().mockResolvedValue(undefined);
  localStorage.setItem(SESSION_GENERATION_KEY, 'generation-a');
  await reconcileAuthorizedSessionOwner(A);
});

describe('CUDYR archive recovery stays with the person whose sync began it', () => {
  it('revives and processes A’s own archive when A is still signed in', async () => {
    expect(await runRecoveryAcross(A, async () => {})).toEqual({
      owner: A,
      status: 'PENDING',
      processed: 1,
    });
  });

  it('revives as usual when another tab of the same person signs in again', async () => {
    expect(await runRecoveryAcross(A, () => otherTabAdmits(A))).toEqual({
      owner: A,
      status: 'PENDING',
      processed: 1,
    });
  });

  it('never revives B’s archive nor asks to process once another tab admitted B', async () => {
    expect(await runRecoveryAcross(B, () => otherTabAdmits(B))).toEqual({
      owner: B,
      status: 'FAILED',
      processed: 0,
    });
  });

  it('leaves A’s archive as it was when A’s logout begins during the wait', async () => {
    let release!: () => void;
    let started!: () => void;
    const closing = new Promise<void>(resolve => (release = resolve));
    const began = new Promise<void>(resolve => (started = resolve));
    let logout: Promise<void> | undefined;
    const result = await runRecoveryAcross(A, async () => {
      logout = clearSessionScopedClientState('manual', async () => {
        started();
        await closing;
      });
      await began;
    });
    release();
    await logout;
    expect(result).toEqual({ owner: A, status: 'FAILED', processed: 0 });
  });

  it('after a reload, the same person’s next run revives the archive kept in the queue', async () => {
    await hospitalDB.syncQueue.add(blockedArchive(A));
    vi.resetModules();
    const reloaded = await import('@/services/storage/sessionScopedStorageService');
    await reloaded.reconcileAuthorizedSessionOwner(A);
    const { recoverCudyrArchivesAfterClinicalSync: recover } =
      await import('@/features/rayen-import/hooks/recoverCudyrArchivesAfterClinicalSync');
    const { guardAuthoringSession: guard } = await import('@/services/storage/authoringSession');
    await recover({ status: 'complete' }, enforced, 3, guard());
    const [row] = await hospitalDB.syncQueue.toArray();
    expect({ owner: row.ownerKey, status: row.status }).toEqual({ owner: A, status: 'PENDING' });
  });
});

describe('the queue revives only the work of the person signed in now', () => {
  it('refuses a revival in another person’s name and keeps the task as it was', async () => {
    const id = await hospitalDB.syncQueue.add(blockedArchive(B));
    localStorage.setItem(SESSION_OWNER_KEY, A);
    expect(await requeueQuarantinedTask(id, B)).toBe(false);
    expect((await hospitalDB.syncQueue.get(id))?.status).toBe('FAILED');
  });

  it('refuses any revival while a logout is in progress', async () => {
    const id = await hospitalDB.syncQueue.add(blockedArchive(A));
    localStorage.setItem(SESSION_CLEANUP_PENDING_KEY, '1');
    expect(await requeueQuarantinedTask(id, A)).toBe(false);
    localStorage.removeItem(SESSION_CLEANUP_PENDING_KEY);
    expect(await requeueQuarantinedTask(id, A)).toBe(true);
    expect((await hospitalDB.syncQueue.get(id))?.status).toBe('PENDING');
  });
});
