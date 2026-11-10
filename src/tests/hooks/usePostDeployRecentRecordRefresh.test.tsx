import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePostDeployRecentRecordRefresh } from '@/hooks/useDailyRecordSyncQuerySupport';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { executePostDeployRecentRecordRefresh } from '@/services/config/postDeployRecentRecordRefresh';

vi.mock('@/services/config/postDeployRecentRecordRefresh', () => ({
  readPostDeployRecentRecordRefreshMarker: () => ({
    version: 1,
    reason: 'version-change',
    fromVersion: 'a',
    toVersion: 'b',
    createdAt: 'synthetic',
  }),
  executePostDeployRecentRecordRefresh: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
  setSessionGeneration(null);
});

it.each(['failed', 'interrupted', 'skipped_queue_not_empty', 'skipped_queue_unavailable'] as const)(
  'allows a later ready evaluation after %s without retrying in a loop',
  async status => {
    const execute = vi.mocked(executePostDeployRecentRecordRefresh);
    execute
      .mockResolvedValueOnce({ status, dates: [], marker: null })
      .mockResolvedValue({ status: 'completed', dates: [], marker: null });
    const refetch = vi.fn(async () => undefined);
    const runRemoteSync = vi.fn(async () => ({ status: 'success' as const }));
    const { rerender } = renderHook(
      ({ ready }) =>
        usePostDeployRecentRecordRefresh({
          remoteSyncStatus: ready ? 'ready' : 'local_only',
          refetch,
          runRemoteSync,
        }),
      { initialProps: { ready: true } }
    );
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(refetch).not.toHaveBeenCalled();
    rerender({ ready: false });
    expect(execute).toHaveBeenCalledTimes(1);
    rerender({ ready: true });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledTimes(2);
    rerender({ ready: true });
    expect(execute).toHaveBeenCalledTimes(2);
  }
);

it('evaluates a retained marker in a fresh session and ignores the old completion', async () => {
  const execute = vi.mocked(executePostDeployRecentRecordRefresh);
  let finish: ((result: Awaited<ReturnType<typeof execute>>) => void) | undefined;
  execute
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ status: 'completed', dates: [], marker: null });
  const refetch = vi.fn(async () => undefined);
  const runRemoteSync = vi.fn(async () => ({ status: 'success' as const }));
  renderHook(() =>
    usePostDeployRecentRecordRefresh({ remoteSyncStatus: 'ready', refetch, runRemoteSync })
  );
  await act(async () => {
    setSessionGeneration('synthetic-B');
  });
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  await act(async () => {
    finish?.({ status: 'interrupted', dates: [], marker: null });
  });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(refetch).toHaveBeenCalledTimes(1);
});
