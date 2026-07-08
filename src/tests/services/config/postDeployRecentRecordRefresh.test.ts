import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncQueueTelemetry } from '@/services/storage/sync';
import {
  clearPostDeployRecentRecordRefreshMarker,
  executePostDeployRecentRecordRefresh,
  POST_DEPLOY_RECENT_RECORD_REFRESH_KEY,
  readPostDeployRecentRecordRefreshMarker,
  resolvePostDeployRecentRecordRefreshDates,
  writePostDeployRecentRecordRefreshMarker,
  type PostDeployRecentRecordRefreshMarker,
} from '@/services/config/postDeployRecentRecordRefresh';

const buildQueueTelemetry = (overrides: Partial<SyncQueueTelemetry> = {}): SyncQueueTelemetry => ({
  pending: 0,
  failed: 0,
  conflict: 0,
  retrying: 0,
  oldestPendingAgeMs: 0,
  batchSize: 20,
  oldestPendingBudgetState: 'ok',
  retryingBudgetState: 'ok',
  runtimeState: 'ok',
  readState: 'ok',
  ...overrides,
});

const buildMarker = (): PostDeployRecentRecordRefreshMarker => ({
  version: 1,
  reason: 'version-change',
  fromVersion: 'deploy-001',
  toVersion: 'deploy-002',
  createdAt: '2026-05-09T03:00:00.000Z',
});

describe('postDeployRecentRecordRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('stores and reads a deploy-change refresh marker', () => {
    writePostDeployRecentRecordRefreshMarker({
      fromVersion: 'deploy-001',
      toVersion: 'deploy-002',
      now: new Date('2026-05-09T03:00:00.000Z'),
    });

    expect(readPostDeployRecentRecordRefreshMarker()).toEqual(buildMarker());

    clearPostDeployRecentRecordRefreshMarker();
    expect(localStorage.getItem(POST_DEPLOY_RECENT_RECORD_REFRESH_KEY)).toBeNull();
  });

  it('resolves recent daily records as today and yesterday only', () => {
    expect(resolvePostDeployRecentRecordRefreshDates('2026-05-09')).toEqual([
      '2026-05-09',
      '2026-05-08',
    ]);
  });

  it('deletes local records for today and yesterday, syncs them remotely, and clears marker', async () => {
    const deleteLocalRecord = vi.fn().mockResolvedValue(undefined);
    const syncRemoteRecord = vi.fn().mockResolvedValue({ status: 'success', issues: [] });
    const clearMarker = vi.fn();

    const result = await executePostDeployRecentRecordRefresh({
      todayDateString: '2026-05-09',
      readMarker: () => buildMarker(),
      clearMarker,
      readSyncQueueTelemetry: async () => buildQueueTelemetry(),
      deleteLocalRecord,
      syncRemoteRecord,
    });

    expect(result.status).toBe('completed');
    expect(deleteLocalRecord).toHaveBeenNthCalledWith(1, '2026-05-09');
    expect(deleteLocalRecord).toHaveBeenNthCalledWith(2, '2026-05-08');
    expect(syncRemoteRecord).toHaveBeenNthCalledWith(1, '2026-05-09');
    expect(syncRemoteRecord).toHaveBeenNthCalledWith(2, '2026-05-08');
    expect(clearMarker).toHaveBeenCalledTimes(1);
  });

  it('does not delete local records when the sync queue has pending or unresolved work', async () => {
    const deleteLocalRecord = vi.fn().mockResolvedValue(undefined);
    const syncRemoteRecord = vi.fn().mockResolvedValue({ status: 'success', issues: [] });
    const clearMarker = vi.fn();

    const result = await executePostDeployRecentRecordRefresh({
      todayDateString: '2026-05-09',
      readMarker: () => buildMarker(),
      clearMarker,
      readSyncQueueTelemetry: async () => buildQueueTelemetry({ pending: 1 }),
      deleteLocalRecord,
      syncRemoteRecord,
    });

    expect(result.status).toBe('skipped_queue_not_empty');
    expect(deleteLocalRecord).not.toHaveBeenCalled();
    expect(syncRemoteRecord).not.toHaveBeenCalled();
    expect(clearMarker).not.toHaveBeenCalled();
  });

  it('does not delete local records when queue telemetry cannot be trusted', async () => {
    const deleteLocalRecord = vi.fn().mockResolvedValue(undefined);
    const syncRemoteRecord = vi.fn().mockResolvedValue({ status: 'success', issues: [] });

    const result = await executePostDeployRecentRecordRefresh({
      todayDateString: '2026-05-09',
      readMarker: () => buildMarker(),
      readSyncQueueTelemetry: async () =>
        buildQueueTelemetry({ readState: 'unavailable', runtimeState: 'blocked' }),
      deleteLocalRecord,
      syncRemoteRecord,
    });

    expect(result.status).toBe('skipped_queue_unavailable');
    expect(deleteLocalRecord).not.toHaveBeenCalled();
    expect(syncRemoteRecord).not.toHaveBeenCalled();
  });
});
