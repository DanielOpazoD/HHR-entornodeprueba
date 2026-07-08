import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncQueueMonitor } from '@/hooks/useSyncQueueMonitor';

const mockGetSyncQueueTelemetry = vi.fn();
const mockListRecentSyncQueueOperations = vi.fn();

vi.mock('@/services/storage/sync', () => ({
  getSyncQueueTelemetry: (...args: unknown[]) => mockGetSyncQueueTelemetry(...args),
  listRecentSyncQueueOperations: (...args: unknown[]) => mockListRecentSyncQueueOperations(...args),
}));

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useSyncQueueMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads sync telemetry into hook state', async () => {
    mockGetSyncQueueTelemetry.mockResolvedValueOnce({
      pending: 2,
      failed: 1,
      retrying: 1,
      conflict: 0,
      batchSize: 25,
      runtimeState: 'degraded',
      readState: 'ok',
    });
    mockListRecentSyncQueueOperations.mockResolvedValueOnce([
      {
        id: 1,
        type: 'UPDATE_DAILY_RECORD',
        status: 'PENDING',
        retryCount: 0,
        timestamp: 123,
      },
    ]);

    const { result } = renderHook(() =>
      useSyncQueueMonitor({ enabled: true, pollIntervalMs: 60_000, operationLimit: 1 })
    );

    await waitFor(() => expect(result.current.stats.pending).toBe(2));
    expect(result.current.stats.runtimeState).toBe('degraded');
    expect(result.current.operations).toEqual([
      {
        id: 1,
        type: 'UPDATE_DAILY_RECORD',
        status: 'PENDING',
        retryCount: 0,
        timestamp: 123,
      },
    ]);
    expect(result.current.hasQueueIssues).toBe(true);
  });

  it('keeps telemetry visible when recent operation lookup is unavailable', async () => {
    mockGetSyncQueueTelemetry.mockResolvedValueOnce({
      pending: 4,
      failed: 0,
      retrying: 0,
      conflict: 0,
      batchSize: 25,
      runtimeState: 'ok',
      readState: 'ok',
    });
    mockListRecentSyncQueueOperations.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    const { result } = renderHook(() =>
      useSyncQueueMonitor({ enabled: true, pollIntervalMs: 60_000, operationLimit: 1 })
    );

    await waitFor(() => expect(result.current.stats.pending).toBe(4));
    expect(result.current.stats).toMatchObject({
      readState: 'ok',
      recentOperationsReadState: 'unavailable',
    });
    expect(result.current.operations).toEqual([]);
    expect(result.current.hasQueueIssues).toBe(true);
  });

  it('keeps the newest refresh result when older requests resolve later', async () => {
    const firstTelemetry = createDeferred<{
      pending: number;
      failed: number;
      retrying: number;
      conflict: number;
      batchSize: number;
      runtimeState: 'ok';
      readState: 'ok';
    }>();
    const firstOperations = createDeferred<
      Array<{
        id: number;
        type: 'UPDATE_DAILY_RECORD';
        status: 'PENDING';
        retryCount: number;
        timestamp: number;
      }>
    >();

    mockGetSyncQueueTelemetry
      .mockResolvedValueOnce({
        pending: 0,
        failed: 0,
        retrying: 0,
        conflict: 0,
        batchSize: 25,
        runtimeState: 'ok',
        readState: 'ok',
      })
      .mockReturnValueOnce(firstTelemetry.promise)
      .mockResolvedValueOnce({
        pending: 3,
        failed: 0,
        retrying: 1,
        conflict: 1,
        batchSize: 25,
        runtimeState: 'blocked',
        readState: 'ok',
      });

    mockListRecentSyncQueueOperations
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(firstOperations.promise)
      .mockResolvedValueOnce([
        {
          id: 2,
          type: 'UPDATE_DAILY_RECORD',
          status: 'FAILED',
          retryCount: 2,
          timestamp: 456,
        },
      ]);

    const { result } = renderHook(() =>
      useSyncQueueMonitor({ enabled: true, pollIntervalMs: 60_000, operationLimit: 1 })
    );

    await waitFor(() => expect(result.current.stats.pending).toBe(0));

    await act(async () => {
      const staleRefresh = result.current.refresh();
      const latestRefresh = result.current.refresh();
      await latestRefresh;
      void staleRefresh;
    });

    expect(result.current.stats.pending).toBe(3);
    expect(result.current.stats.runtimeState).toBe('blocked');
    expect(result.current.operations).toEqual([
      {
        id: 2,
        type: 'UPDATE_DAILY_RECORD',
        status: 'FAILED',
        retryCount: 2,
        timestamp: 456,
      },
    ]);

    await act(async () => {
      firstTelemetry.resolve({
        pending: 1,
        failed: 0,
        retrying: 0,
        conflict: 0,
        batchSize: 25,
        runtimeState: 'ok',
        readState: 'ok',
      });
      firstOperations.resolve([
        {
          id: 1,
          type: 'UPDATE_DAILY_RECORD',
          status: 'PENDING',
          retryCount: 0,
          timestamp: 123,
        },
      ]);
      await Promise.resolve();
    });

    expect(result.current.stats.pending).toBe(3);
    expect(result.current.operations).toEqual([
      {
        id: 2,
        type: 'UPDATE_DAILY_RECORD',
        status: 'FAILED',
        retryCount: 2,
        timestamp: 456,
      },
    ]);
  });
});
