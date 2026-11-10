import { executeSyncDailyRecord } from '@/application/daily-record/syncDailyRecordUseCase';
import { defaultDailyRecordSyncPort } from '@/application/ports/dailyRecordPort';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const deleteLocalRecord = vi.fn().mockResolvedValue(true);
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

  it.each(['pending', 'failed', 'conflict', 'retrying'] as const)(
    'does not delete local records when the sync queue has %s work',
    async field => {
      const deleteLocalRecord = vi.fn().mockResolvedValue(true);
      const syncRemoteRecord = vi.fn().mockResolvedValue({ status: 'success', issues: [] });
      const clearMarker = vi.fn();

      const result = await executePostDeployRecentRecordRefresh({
        todayDateString: '2026-05-09',
        readMarker: () => buildMarker(),
        clearMarker,
        readSyncQueueTelemetry: async () => buildQueueTelemetry({ [field]: 1 }),
        deleteLocalRecord,
        syncRemoteRecord,
      });

      expect(result.status).toBe('skipped_queue_not_empty');
      expect(deleteLocalRecord).not.toHaveBeenCalled();
      expect(syncRemoteRecord).not.toHaveBeenCalled();
      expect(clearMarker).not.toHaveBeenCalled();
    }
  );

  it('does not delete local records when queue telemetry cannot be trusted', async () => {
    const deleteLocalRecord = vi.fn().mockResolvedValue(true);
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

const refreshArgs = () => ({
  todayDateString: '2026-11-10',
  readMarker: buildMarker,
  clearMarker: vi.fn(),
  readSyncQueueTelemetry: vi.fn(async () => buildQueueTelemetry()),
  deleteLocalRecord: vi.fn(async () => true),
  syncRemoteRecord: vi.fn(async () => ({ status: 'success' as const })),
});
const changeSession = (sameOwner = false) => {
  setSessionGeneration(null);
  localStorage.setItem(SESSION_OWNER_KEY, sameOwner ? 'user:synthetic-A' : 'user:synthetic-B');
  setSessionGeneration(sameOwner ? 'synthetic-A' : 'synthetic-B');
};

describe('truthful session-bound recent recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
    setSessionGeneration('synthetic-A');
  });
  afterEach(() => {
    localStorage.clear();
    setSessionGeneration(null);
  });

  it('does not confirm recovery when the real sync use case returns failed', async () => {
    const args = refreshArgs();
    const result = await executePostDeployRecentRecordRefresh({
      ...args,
      syncRemoteRecord: date =>
        executeSyncDailyRecord({
          date,
          repository: {
            ...defaultDailyRecordSyncPort,
            syncWithFirestoreDetailed: async () => {
              throw new Error('synthetic offline');
            },
          },
        }),
    });
    expect(result.status).toBe('failed');
    expect(args.clearMarker).not.toHaveBeenCalled();
    expect(args.deleteLocalRecord).toHaveBeenCalledTimes(1);
    expect(recordOperationalTelemetry).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
      expect.anything()
    );
  });

  it.each(['failed', 'degraded', 'partial'] as const)(
    'retains marker and stops on %s',
    async status => {
      const args = refreshArgs();
      const result = await executePostDeployRecentRecordRefresh({
        ...args,
        syncRemoteRecord: vi.fn(async () => ({ status })),
      });
      expect(result.status).toBe('failed');
      expect(args.deleteLocalRecord).toHaveBeenCalledTimes(1);
      expect(args.clearMarker).not.toHaveBeenCalled();
    }
  );

  it('retains marker on a thrown read', async () => {
    const args = refreshArgs();
    expect(
      (
        await executePostDeployRecentRecordRefresh({
          ...args,
          syncRemoteRecord: async () => {
            throw new Error('synthetic');
          },
        })
      ).status
    ).toBe('failed');
    expect(args.clearMarker).not.toHaveBeenCalled();
    expect(args.deleteLocalRecord).toHaveBeenCalledTimes(1);
  });

  it('stops deletes when the session changes during remote wait', async () => {
    const args = refreshArgs();
    await executePostDeployRecentRecordRefresh({
      ...args,
      syncRemoteRecord: async () => {
        changeSession();
        return { status: 'success' };
      },
    });
    expect(args.deleteLocalRecord).toHaveBeenCalledTimes(1);
    expect(args.clearMarker).not.toHaveBeenCalled();
  });

  it.each(['telemetry', 'deletion', 'read'] as const)(
    'stops after change during %s, including same-owner readmission',
    async stage => {
      const args = refreshArgs();
      if (stage === 'telemetry')
        args.readSyncQueueTelemetry.mockImplementation(async () => {
          changeSession(true);
          return buildQueueTelemetry();
        });
      if (stage === 'deletion')
        args.deleteLocalRecord.mockImplementation(async () => {
          changeSession(true);
          return true;
        });
      if (stage === 'read')
        args.syncRemoteRecord.mockImplementation(async () => {
          changeSession(true);
          return { status: 'success' };
        });
      const result = await executePostDeployRecentRecordRefresh(args);
      expect(result.status).toBe('interrupted');
      expect(args.deleteLocalRecord).toHaveBeenCalledTimes(stage === 'telemetry' ? 0 : 1);
      expect(args.syncRemoteRecord).toHaveBeenCalledTimes(stage === 'read' ? 1 : 0);
      expect(args.clearMarker).not.toHaveBeenCalled();
      expect(recordOperationalTelemetry).not.toHaveBeenCalled();
    }
  );

  it('stops on owner change even without an epoch change', async () => {
    const args = refreshArgs();
    args.readSyncQueueTelemetry.mockImplementation(async () => {
      localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
      return buildQueueTelemetry();
    });
    await executePostDeployRecentRecordRefresh(args);
    expect(args.deleteLocalRecord).not.toHaveBeenCalled();
    expect(args.clearMarker).not.toHaveBeenCalled();
  });

  it('preserves a day held after the initial queue snapshot', async () => {
    const args = refreshArgs();
    args.deleteLocalRecord.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await executePostDeployRecentRecordRefresh(args)).status).toBe(
      'skipped_queue_not_empty'
    );
    expect(args.syncRemoteRecord).toHaveBeenCalledTimes(1);
    expect(args.clearMarker).not.toHaveBeenCalled();
  });
});
