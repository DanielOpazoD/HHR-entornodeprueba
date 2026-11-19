import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';
const h = vi.hoisted(() => ({ get: vi.fn(), archive: vi.fn() }));
vi.mock('firebase/firestore', () => ({ getDoc: h.get }));
vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  getRecordDocRef: (date: string) => date,
}));
vi.mock('@/services/cudyr/cudyrHistoryService', () => ({ archiveCudyrHistory: h.archive }));
import { replayCudyrArchive } from '@/services/storage/sync/cudyrArchiveTransport';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

const request = {
  schemaVersion: 1,
  authorityDate: '2026-10-06',
  runId: 'old-run',
  evaluations: [],
  capture: { id: 'capture-id', sourceRunId: 'old-run', observedAt: '2026-10-06T20:00:00.000Z' },
};
const task: SyncTask = {
  opId: 'op-test',
  type: 'ARCHIVE_CUDYR',
  ownerKey: 'user:synthetic',
  payload: { id: 'task-test', request },
  timestamp: 0,
  retryCount: 0,
  status: 'PROCESSING',
};
const runtime = {} as FirestoreServiceRuntimePort;
/** The replay sends with the guard it captured, so the door asks the same session. */
const withGuard = expect.objectContaining({ check: expect.any(Function) });
afterEach(clearSyntheticSession);
beforeEach(() => {
  vi.clearAllMocks();
  admitSyntheticSession('user:synthetic', 'session-test');
  h.get.mockResolvedValue({
    exists: () => true,
    data: () => ({ rayenSync: { runId: 'new-run' } }),
  });
  h.archive.mockResolvedValue({
    success: true,
    persisted: true,
    results: [],
    captureReceiptId: 'receipt',
  });
});
describe('CUDYR replay authority and ownership', () => {
  it('refreshes the authority of the same census while preserving the original captured source', async () => {
    await replayCudyrArchive(task, runtime);
    expect(h.get).toHaveBeenCalledWith('2026-10-06');
    expect(h.archive).toHaveBeenCalledWith({ ...request, runId: 'new-run' }, withGuard);
    expect(request.runId).toBe('old-run');
  });
  it('replays a durable capture after the same owner signs in with a new admitted generation', async () => {
    admitSyntheticSession('user:synthetic', 'new-admitted-session');
    await replayCudyrArchive(task, runtime);
    expect(h.archive).toHaveBeenCalledWith({ ...request, runId: 'new-run' }, withGuard);
  });
  it('does not dispatch another owner’s capture', async () => {
    replaceStoredSessionOwner('user:other');
    await expect(replayCudyrArchive(task, runtime)).rejects.toThrow('sesión cambió');
    expect(h.get).not.toHaveBeenCalled();
    expect(h.archive).not.toHaveBeenCalled();
  });
  it('rechecks the session after awaiting the authoritative census', async () => {
    h.get.mockImplementation(async () => {
      admitSyntheticSession('user:synthetic', 'replacement');
      return { exists: () => true, data: () => ({ rayenSync: { runId: 'new-run' } }) };
    });
    await expect(replayCudyrArchive(task, runtime)).rejects.toThrow('sesión cambió');
    expect(h.archive).not.toHaveBeenCalled();
  });
  it('retains failure when the source census is no longer available', async () => {
    h.get.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(replayCudyrArchive(task, runtime)).rejects.toThrow('verificar');
    expect(h.archive).not.toHaveBeenCalled();
  });
});
