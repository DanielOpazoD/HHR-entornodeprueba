import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { ensureUserRoleClaimMock, getCurrentUserMock } = vi.hoisted(() => ({
  ensureUserRoleClaimMock: vi.fn().mockResolvedValue(undefined),
  getCurrentUserMock: vi.fn(),
}));

vi.mock('@/services/auth/authClaimSyncService', () => ({
  ensureUserRoleClaim: ensureUserRoleClaimMock,
}));

vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    getCurrentUser: getCurrentUserMock,
  },
}));

import { useAuthClaimRefreshScheduler } from '@/hooks/useAuthClaimRefreshScheduler';

const dispatchVisibilityChange = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useAuthClaimRefreshScheduler', () => {
  beforeEach(() => {
    ensureUserRoleClaimMock.mockClear();
    getCurrentUserMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when disabled', () => {
    getCurrentUserMock.mockReturnValue({ uid: 'uid-1' });
    renderHook(() =>
      useAuthClaimRefreshScheduler({ enabled: false, role: 'nurse_hospital', intervalMs: 1000 })
    );
    vi.advanceTimersByTime(5000);
    expect(ensureUserRoleClaimMock).not.toHaveBeenCalled();
  });

  it('does nothing when no role is resolved yet', () => {
    getCurrentUserMock.mockReturnValue({ uid: 'uid-1' });
    renderHook(() => useAuthClaimRefreshScheduler({ enabled: true, role: null, intervalMs: 1000 }));
    vi.advanceTimersByTime(5000);
    expect(ensureUserRoleClaimMock).not.toHaveBeenCalled();
  });

  it('reconciles the claim on every interval tick when enabled and role resolved', () => {
    const firebaseUser = { uid: 'uid-1' };
    getCurrentUserMock.mockReturnValue(firebaseUser);

    renderHook(() =>
      useAuthClaimRefreshScheduler({
        enabled: true,
        role: 'nurse_hospital',
        intervalMs: 1000,
      })
    );

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(ensureUserRoleClaimMock).toHaveBeenCalledTimes(3);
    expect(ensureUserRoleClaimMock).toHaveBeenCalledWith(firebaseUser, 'nurse_hospital');
  });

  it('also reconciles immediately when the tab becomes visible again', () => {
    const firebaseUser = { uid: 'uid-1' };
    getCurrentUserMock.mockReturnValue(firebaseUser);

    renderHook(() =>
      useAuthClaimRefreshScheduler({
        enabled: true,
        role: 'admin',
        intervalMs: 60000,
      })
    );

    // Tab goes hidden → no extra call.
    dispatchVisibilityChange('hidden');
    expect(ensureUserRoleClaimMock).not.toHaveBeenCalled();

    // Tab returns visible → reconciles right away, before the interval ticks.
    dispatchVisibilityChange('visible');
    expect(ensureUserRoleClaimMock).toHaveBeenCalledTimes(1);
  });

  it('skips the call when there is no Firebase user (race during sign-out)', () => {
    getCurrentUserMock.mockReturnValue(null);

    renderHook(() =>
      useAuthClaimRefreshScheduler({
        enabled: true,
        role: 'admin',
        intervalMs: 1000,
      })
    );

    vi.advanceTimersByTime(5000);
    expect(ensureUserRoleClaimMock).not.toHaveBeenCalled();
  });

  it('cleans up the interval and listener on unmount', () => {
    getCurrentUserMock.mockReturnValue({ uid: 'uid-1' });

    const { unmount } = renderHook(() =>
      useAuthClaimRefreshScheduler({
        enabled: true,
        role: 'editor',
        intervalMs: 1000,
      })
    );

    unmount();
    vi.advanceTimersByTime(5000);
    dispatchVisibilityChange('visible');
    expect(ensureUserRoleClaimMock).not.toHaveBeenCalled();
  });
});
