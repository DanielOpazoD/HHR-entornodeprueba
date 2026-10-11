import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';

const h = vi.hoisted(() => ({ archive: vi.fn() }));
vi.mock('@/services/cudyr/cudyrHistoryService', () => ({ archiveCudyrHistory: h.archive }));
vi.mock('@/services/storage/sessionScopedStorageService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/sessionScopedStorageService')>()),
  getStoredSessionOwnerKey: () => 'user:synthetic',
}));
vi.mock('@/services/storage/sessionStorageTransition', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/sessionStorageTransition')>()),
  getSessionGeneration: () => 'session-test',
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ rayenSync: { runId: 'verified-new-run' } }),
  }),
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-doc' }),
}));
import { persistCudyrArchivePart } from '@/services/cudyr/cudyrArchiveQueue';
import { processSyncQueue } from '@/services/storage/sync/publicSyncQueue';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { enqueueStandaloneSyncTask } from '@/services/storage/sync/enqueueStandaloneSyncTask';

const request: ArchiveCudyrHistoryRequest = {
  schemaVersion: 1,
  authorityDate: '2026-10-06',
  runId: 'source-run',
  evaluations: [
    {
      clinicalEpisodeId: 'episode-test',
      sourceEvaluationId: 'event-test',
      source: 'gestion_camas',
      category: 'C2',
      recordedAt: '2026-10-04T03:00:00-05:00',
      author: 'Autor sintético',
    },
  ],
  capture: {
    id: '00000000-0000-4000-8000-000000000001',
    clinicalEpisodeId: 'episode-test',
    sourceRunId: 'source-run',
    observedAt: '2026-10-06T20:00:00.000Z',
    status: 'observed',
    metadataStatus: 'partial',
    part: 0,
    totalParts: 1,
    totalEvaluations: 1,
  },
};
beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});
describe('CUDYR archive real IndexedDB outbox', () => {
  it('keeps the shared capacity limit across concurrent captures using separate store instances', async () => {
    const enqueue = (id: string) =>
      enqueueStandaloneSyncTask(
        {
          store: createDexieSyncQueueStore(),
          runtime: {
            getOwnerKey: () => 'user:synthetic',
            isOnline: () => false,
            onOnline: () => {},
          },
          maxPendingTasks: 2,
          triggerProcessing: vi.fn(),
        },
        'ARCHIVE_CUDYR',
        { id, request },
        { contexts: ['clinical'] },
        { deferProcessing: true }
      );
    const existingId = '00000000-0000-4000-8000-000000000001';
    expect((await enqueue(existingId)).accepted).toBe(true);
    const results = await Promise.all(
      [2, 3, 4].map(index => enqueue(`00000000-0000-4000-8000-00000000000${index}`))
    );
    expect(results.filter(result => result.accepted)).toHaveLength(1);
    expect(results.filter(result => result.mode === 'rejected_backpressure')).toHaveLength(2);
    expect(await hospitalDB.syncQueue.count()).toBe(2);
    expect((await enqueue(existingId)).mode).toBe('reused');
    expect(await hospitalDB.syncQueue.count()).toBe(2);
  });
  it('survives a database reopen and replays the exact captured history after the connection returns', async () => {
    h.archive.mockRejectedValueOnce(new Error('offline'));
    expect(await persistCudyrArchivePart(request)).toBe('queued');
    hospitalDB.close();
    await hospitalDB.open();
    const pending = await hospitalDB.syncQueue.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: 'ARCHIVE_CUDYR',
      ownerKey: 'user:synthetic',
      payload: { request },
    });
    h.archive.mockResolvedValue({
      success: true,
      persisted: true,
      captureReceiptId: 'receipt-test',
      results: [{ id: 'observation', eventKey: 'event', status: 'recorded' }],
    });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();
    await vi.waitFor(async () => {
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    });
    expect(h.archive).toHaveBeenLastCalledWith({ ...request, runId: 'verified-new-run' });
  });
});
