import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSystemHealthReporter } from '@/hooks/admin/useSystemHealthReporter';
import {
  readLastSystemHealthReportAt,
  readLastSystemHealthSignature,
} from '@/hooks/controllers/systemHealthReporterController';

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  auth: {
    currentUser: { uid: 'synthetic-a', email: 'a@example.invalid', displayName: 'Synthetic A' },
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
vi.mock('@/services/storage/firestore', () => ({ firestoreDb: { setDoc: mocks.write } }));
vi.mock('@/services/errorLogService', () => ({ fetchErrorLogs: async () => [] }));
vi.mock('@/services/storage/sync', () => ({
  listRecentSyncQueueOperations: async () => [],
  getSyncQueueTelemetry: async () => ({
    pending: 0,
    failed: 0,
    conflict: 0,
    retrying: 0,
    oldestPendingAgeMs: 0,
    batchSize: 25,
    readState: 'ok',
    runtimeState: 'ok',
  }),
}));

beforeEach(() => {
  localStorage.clear();
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.auth = {
    ...mocks.auth,
    currentUser: { uid: 'synthetic-a', email: 'a@example.invalid', displayName: 'Synthetic A' },
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['unavailable', 'permission-denied'])(
  'retries an unchanged report after %s without a false receipt',
  async code => {
    mocks.write.mockRejectedValueOnce({ code });
    const timer = vi.spyOn(globalThis, 'setInterval');
    const hook = renderHook(() => useSystemHealthReporter());
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(readLastSystemHealthReportAt('synthetic-a')).toBe(0);
    expect(readLastSystemHealthSignature('synthetic-a')).toBeNull();
    const evaluate = timer.mock.calls[0]?.[0];
    if (typeof evaluate !== 'function') throw new Error('Missing reporter evaluation');
    vi.setSystemTime(new Date('2026-11-10T12:02:00Z'));
    await act(async () => {
      evaluate();
    });
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readLastSystemHealthSignature('synthetic-a')).not.toBeNull());
    expect(readLastSystemHealthReportAt('synthetic-a')).toBe(Date.now());
    vi.setSystemTime(new Date('2026-11-10T12:04:00Z'));
    await act(async () => {
      evaluate();
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    hook.unmount();
  }
);

it('does not persist a receipt after unmounting during the write', async () => {
  let finish = () => {};
  mocks.write.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      })
  );
  const hook = renderHook(() => useSystemHealthReporter());
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  hook.unmount();
  await act(async () => {
    finish();
  });
  expect(readLastSystemHealthReportAt('synthetic-a')).toBe(0);
  expect(readLastSystemHealthSignature('synthetic-a')).toBeNull();
});

it('keeps the active user receipt when the prior user write finishes late', async () => {
  let finishA = () => {};
  mocks.write.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finishA = resolve;
      })
  );
  const hook = renderHook(() => useSystemHealthReporter());
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
  mocks.auth = {
    ...mocks.auth,
    currentUser: { uid: 'synthetic-b', email: 'b@example.invalid', displayName: 'Synthetic B' },
  };
  hook.rerender();
  await waitFor(() => expect(readLastSystemHealthSignature('synthetic-b')).not.toBeNull());
  const receiptB = readLastSystemHealthReportAt('synthetic-b');
  vi.setSystemTime(new Date('2026-11-10T12:01:00Z'));
  await act(async () => {
    finishA();
  });
  expect(readLastSystemHealthReportAt('synthetic-a')).toBe(0);
  expect(readLastSystemHealthSignature('synthetic-a')).toBeNull();
  expect(readLastSystemHealthReportAt('synthetic-b')).toBe(receiptB);
  expect(mocks.write.mock.calls.map(call => call[1])).toEqual(['synthetic-a', 'synthetic-b']);
});
