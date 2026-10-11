import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  archive: vi.fn(),
  queue: vi.fn(),
  process: vi.fn(),
  remove: vi.fn(),
  release: vi.fn(),
  owner: 'user:synthetic',
  generation: 'session-test',
  fallback: false,
}));
vi.mock('@/services/cudyr/cudyrHistoryService', () => ({ archiveCudyrHistory: h.archive }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  ensureDbReady: async () => {},
  isDatabaseInFallbackMode: () => h.fallback,
}));
vi.mock('@/services/storage/sync/dexieSyncQueueStore', () => ({
  createDexieSyncQueueStore: () => ({
    deletePendingByKey: h.remove,
    releasePreOutboxHoldByKey: h.release,
  }),
}));
vi.mock('@/services/storage/sync/publicSyncQueue', () => ({
  queueCudyrArchiveTask: h.queue,
  processSyncQueue: h.process,
}));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: () => h.owner,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => h.generation,
}));

import { persistCudyrArchivePart } from '@/services/cudyr/cudyrArchiveQueue';
import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';

const request: ArchiveCudyrHistoryRequest = {
  schemaVersion: 1,
  authorityDate: '2026-10-06',
  runId: 'source-run',
  evaluations: [],
  capture: {
    id: '00000000-0000-4000-8000-000000000001',
    clinicalEpisodeId: 'episode-test',
    sourceRunId: 'source-run',
    observedAt: '2026-10-06T20:00:00.000Z',
    status: 'observed',
    metadataStatus: 'complete',
    part: 0,
    totalParts: 1,
    totalEvaluations: 0,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = 'user:synthetic';
  h.generation = 'session-test';
  h.fallback = false;
  h.queue.mockResolvedValue({ accepted: true });
  h.archive.mockResolvedValue({
    success: true,
    persisted: true,
    results: [],
    captureReceiptId: 'receipt',
  });
  h.remove.mockResolvedValue(true);
  h.release.mockResolvedValue(true);
  h.process.mockResolvedValue(undefined);
});

describe('durable CUDYR archive handoff', () => {
  it('saves the exact snapshot before sending and removes it only after a complete acknowledgement', async () => {
    expect(await persistCudyrArchivePart(request)).toBe('persisted');
    expect(h.queue).toHaveBeenCalledWith(
      { id: expect.any(String), request },
      expect.objectContaining({ deferProcessing: true })
    );
    expect(h.queue.mock.invocationCallOrder[0]).toBeLessThan(h.archive.mock.invocationCallOrder[0]);
    expect(h.archive.mock.invocationCallOrder[0]).toBeLessThan(
      h.remove.mock.invocationCallOrder[0]
    );
  });
  it.each(['network', 'incomplete_ack'])(
    'retains the queue on %s instead of treating it as saved remotely',
    async mode => {
      if (mode === 'network') h.archive.mockRejectedValue(new Error('offline'));
      else h.archive.mockResolvedValue({ success: true, persisted: true, results: [] });
      expect(await persistCudyrArchivePart(request)).toBe('queued');
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.release).toHaveBeenCalledOnce();
      expect(h.process).toHaveBeenCalledOnce();
    }
  );
  it('retains a captured snapshot for background delivery when the foreground watchdog expires', async () => {
    expect(await persistCudyrArchivePart(request, AbortSignal.abort())).toBe('queued');
    expect(h.queue).toHaveBeenCalledOnce();
    expect(h.archive).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledOnce();
  });
  it('does not send if durable storage rejects the capture', async () => {
    h.queue.mockResolvedValue({ accepted: false, mode: 'rejected_backpressure' });
    expect(await persistCudyrArchivePart(request)).toBe('failed');
    expect(h.archive).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])(
    'returns on an in-flight abort and ignores late RPC %s',
    async outcome => {
      let settle!: () => void;
      let started!: () => void;
      const dispatched = new Promise<void>(resolve => {
        started = resolve;
      });
      h.archive.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              outcome === 'resolve'
                ? resolve({
                    success: true,
                    persisted: true,
                    results: [],
                    captureReceiptId: 'receipt',
                  })
                : reject(new Error('Late transport failure'));
            started();
          })
      );
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      const pending = persistCudyrArchivePart(request, controller.signal);
      await dispatched;
      controller.abort();
      expect(await pending).toBe('queued');
      expect(h.release).toHaveBeenCalledOnce();
      expect(h.process).toHaveBeenCalledOnce();
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
      settle();
      await Promise.resolve();
      expect(h.remove).not.toHaveBeenCalled();
    }
  );
  it('does not call an in-memory fallback durable', async () => {
    h.fallback = true;
    expect(await persistCudyrArchivePart(request)).toBe('failed');
    expect(h.queue).not.toHaveBeenCalled();
  });
  it('stops dispatch when the user session changes while enqueuing', async () => {
    h.queue.mockImplementation(async () => {
      h.owner = 'user:other';
      return { accepted: true };
    });
    expect(await persistCudyrArchivePart(request)).toBe('failed');
    expect(h.archive).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('keeps confirmed remote success if only local acknowledgement cleanup fails', async () => {
    h.remove.mockRejectedValue(new Error('local storage unavailable'));
    expect(await persistCudyrArchivePart(request)).toBe('persisted');
    expect(h.release).not.toHaveBeenCalled();
  });
});
