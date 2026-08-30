import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureDbReady = vi.fn();
const getStats = vi.fn();
const getTelemetry = vi.fn();
const listRecentOperations = vi.fn();
const getDomainMetrics = vi.fn();
const queueTask = vi.fn();
const processQueue = vi.fn();
const recordOperationalTelemetry = vi.fn();

vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  ensureDbReady,
}));

vi.mock('@/services/storage/sync/browserSyncRuntime', () => ({
  createBrowserSyncRuntime: () => ({ getOwnerKey: () => null }),
}));

vi.mock('@/services/storage/sync/dexieSyncQueueStore', () => ({
  createDexieSyncQueueStore: () => ({}),
}));

vi.mock('@/services/storage/sync/firestoreSyncTransport', () => ({
  createFirestoreSyncTransport: () => ({}),
}));

vi.mock('@/services/storage/sync/syncQueueEngine', () => ({
  createSyncQueueEngine: () => ({
    getStats,
    getTelemetry,
    listRecentOperations,
    getDomainMetrics,
    queueTask,
    processQueue,
    triggerProcessing: vi.fn(),
    ensureOnlineListener: vi.fn(),
  }),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry,
}));

describe('publicSyncQueue operational fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns blocked telemetry and records an event when sync telemetry cannot be read', async () => {
    ensureDbReady.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    const { getSyncQueueTelemetry } = await import('@/services/storage/sync/publicSyncQueue');
    const telemetry = await getSyncQueueTelemetry();

    expect(telemetry.readState).toBe('unavailable');
    expect(telemetry.runtimeState).toBe('blocked');
    expect(telemetry.issues).toEqual(['IndexedDB unavailable']);
    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'sync_queue_telemetry_unavailable',
        runtimeState: 'blocked',
      })
    );
  });

  it('records a structured event when enqueueing a sync task fails', async () => {
    ensureDbReady.mockRejectedValueOnce(new Error('queue closed'));

    const { queueSyncTask } = await import('@/services/storage/sync/publicSyncQueue');
    await queueSyncTask('UPDATE_DAILY_RECORD', { date: '2026-03-23' }, { contexts: ['clinical'] });

    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'sync_queue_enqueue_failure',
        runtimeState: 'blocked',
        context: expect.objectContaining({
          type: 'UPDATE_DAILY_RECORD',
          contexts: ['clinical'],
        }),
      })
    );
  });

  it('records a structured event when processing the queue fails', async () => {
    ensureDbReady.mockResolvedValueOnce(undefined);
    processQueue.mockRejectedValueOnce(new Error('transport failed'));

    const { processSyncQueue } = await import('@/services/storage/sync/publicSyncQueue');
    await processSyncQueue();

    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'sync_queue_process_failure',
        runtimeState: 'blocked',
      })
    );
  });
});
