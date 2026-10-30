import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSystemHealthReporter } from '@/hooks/admin/useSystemHealthReporter';

const mocks = vi.hoisted(() => ({
  operations: vi.fn(),
  errorLogs: vi.fn(async () => [] as unknown[]),
  report: vi.fn(),
  auth: {
    currentUser: {
      uid: 'synthetic-health-user',
      email: 'health@example.test',
      displayName: 'Synthetic',
    },
    role: 'admin',
    remoteSyncStatus: 'ready',
    remoteSyncState: { reason: 'ready' },
    sessionState: 'authenticated',
    isLoading: false,
    isFirebaseConnected: true,
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ isOutdated: false, updateReason: 'current' }),
}));
vi.mock('@tanstack/react-query', () => ({ useIsMutating: () => 0 }));
vi.mock('@/services/errorLogService', () => ({ fetchErrorLogs: mocks.errorLogs }));
vi.mock('@/services/admin/healthService', () => ({ reportUserHealth: mocks.report }));
vi.mock('@/services/storage/sync', () => ({
  listRecentSyncQueueOperations: mocks.operations,
  getSyncQueueTelemetry: async () => ({
    pending: 3,
    failed: 1,
    conflict: 0,
    retrying: 1,
    oldestPendingAgeMs: 5000,
    batchSize: 25,
    readState: 'ok',
    runtimeState: 'degraded',
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

it('still reports known queue counts when the recent-operation read rejects', async () => {
  mocks.operations.mockRejectedValue(new Error('Synthetic recent-operation failure'));
  renderHook(() => useSystemHealthReporter());

  await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
  expect(mocks.report).toHaveBeenCalledWith(
    expect.objectContaining({
      pendingSyncTasks: 3,
      failedSyncTasks: 1,
      retryingSyncTasks: 1,
    })
  );
});

it('still reports its other counts when the local error history cannot be read', async () => {
  mocks.operations.mockResolvedValue([]);
  mocks.errorLogs.mockRejectedValueOnce(new Error('Synthetic store failure'));
  renderHook(() => useSystemHealthReporter());

  await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
  expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ pendingSyncTasks: 3 }));
});
