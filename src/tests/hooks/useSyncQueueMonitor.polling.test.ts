import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncQueueMonitor } from '@/hooks/useSyncQueueMonitor';
const mocks = vi.hoisted(() => ({ telemetry: vi.fn(), operations: vi.fn() }));
vi.mock('@/services/storage/sync', () => ({
  getSyncQueueTelemetry: mocks.telemetry,
  listRecentSyncQueueOperations: mocks.operations,
}));
const telemetry = {
  pending: 2,
  failed: 0,
  retrying: 0,
  conflict: 0,
  batchSize: 25,
  runtimeState: 'ok',
  readState: 'ok',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.telemetry.mockResolvedValue(telemetry);
  mocks.operations.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('sync queue monitor polling', () => {
  it('lets a slow periodic read finish without overlapping or starving its result', async () => {
    const pending = deferred<typeof telemetry>();
    mocks.telemetry.mockReturnValueOnce(pending.promise);
    const view = renderHook(() => useSyncQueueMonitor());
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(1);
    expect(mocks.operations).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(telemetry));
    expect(view.result.current.stats.pending).toBe(2);
    mocks.telemetry.mockResolvedValueOnce({ ...telemetry, pending: 3 });
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(2);
    expect(view.result.current.stats.pending).toBe(3);
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(8_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(2);
  });
  it('invalidates a read when disabled and resumes with fresh data when enabled', async () => {
    const pending = deferred<typeof telemetry>();
    mocks.telemetry.mockReturnValueOnce(pending.promise);
    const view = renderHook(({ enabled }) => useSyncQueueMonitor({ enabled }), {
      initialProps: { enabled: true },
    });
    view.rerender({ enabled: false });
    await act(async () => {
      pending.resolve(telemetry);
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(view.result.current.stats.pending).toBe(0);
    expect(mocks.telemetry).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: true });
    await act(async () => undefined);
    expect(view.result.current.stats.pending).toBe(2);
    expect(mocks.telemetry).toHaveBeenCalledTimes(2);
  });
  it('resumes periodic reads after both data sources fail', async () => {
    mocks.telemetry.mockRejectedValueOnce(new Error('synthetic telemetry failure'));
    mocks.operations.mockRejectedValueOnce(new Error('synthetic operations failure'));
    const view = renderHook(() => useSyncQueueMonitor());
    await act(async () => undefined);
    expect(view.result.current.stats.readState).toBe('unavailable');
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(2);
    expect(view.result.current.stats.readState).toBe('ok');
    expect(view.result.current.stats.pending).toBe(2);
  });

  it('resumes polling after manual recovery without waiting for a superseded read', async () => {
    const old = deferred<typeof telemetry>();
    const next = deferred<typeof telemetry>();
    mocks.telemetry
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ...telemetry, pending: 5 })
      .mockReturnValueOnce(next.promise);
    const view = renderHook(() => useSyncQueueMonitor());
    await act(async () => view.result.current.refresh());
    expect(view.result.current.stats.pending).toBe(5);
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(3);
    await act(async () => old.resolve(telemetry));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(3);
    expect(view.result.current.stats.pending).toBe(5);
    await act(async () => next.resolve({ ...telemetry, pending: 6 }));
    expect(view.result.current.stats.pending).toBe(6);
  });

  it('waits for a slow manual refresh before starting another automatic read', async () => {
    const old = deferred<typeof telemetry>();
    const manual = deferred<typeof telemetry>();
    mocks.telemetry.mockReturnValueOnce(old.promise).mockReturnValueOnce(manual.promise);
    const view = renderHook(() => useSyncQueueMonitor());
    let work!: Promise<void>;
    act(() => {
      work = view.result.current.refresh();
    });
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(2);
    await act(async () => {
      manual.resolve({ ...telemetry, pending: 5 });
      await work;
    });
    expect(view.result.current.stats.pending).toBe(5);
    await act(async () => old.resolve(telemetry));
    expect(view.result.current.stats.pending).toBe(5);
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(mocks.telemetry).toHaveBeenCalledTimes(3);
  });

  it('still allows an explicit refresh to supersede a pending periodic read', async () => {
    const pending = deferred<typeof telemetry>();
    mocks.telemetry.mockReturnValueOnce(pending.promise);
    const view = renderHook(() => useSyncQueueMonitor());
    mocks.telemetry.mockResolvedValueOnce({ ...telemetry, pending: 5 });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.stats.pending).toBe(5);
    await act(async () => pending.resolve(telemetry));
    expect(view.result.current.stats.pending).toBe(5);
  });
});
