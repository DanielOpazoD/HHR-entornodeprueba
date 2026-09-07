import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInactivityLogout } from '@/hooks/useAuthStateSessionSupport';
import { SESSION_TIMEOUT_MS } from '@/constants/security';
import type { AuthUser } from '@/types/authRoleTypes';

const user: AuthUser = { uid: 'activity-test', email: null, displayName: 'Test', role: 'admin' };
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  localStorage.clear();
});

it('rechecks shared activity before an idle tab logs out', () => {
  const logout = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useInactivityLogout(user, logout));
  act(() => vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000));
  // Another tab writes activity; its storage event may be queued while this tab sleeps.
  localStorage.setItem('hhr_auth_activity:activity-test', String(Date.now()));
  act(() => vi.advanceTimersByTime(1000));
  expect(logout).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000));
  act(() => vi.advanceTimersByTime(1000));
  expect(logout).toHaveBeenCalledExactlyOnceWith('automatic');
  hook.unmount();
});

it('does not restart inactivity when the user object or logout callback changes', () => {
  const firstLogout = vi.fn();
  const latestLogout = vi.fn();
  const hook = renderHook(({ current, logout }) => useInactivityLogout(current, logout), {
    initialProps: { current: user, logout: firstLogout },
  });
  act(() => vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000));
  hook.rerender({ current: { ...user }, logout: latestLogout });
  act(() => vi.advanceTimersByTime(1000));
  act(() => vi.advanceTimersByTime(1000));
  expect(firstLogout).not.toHaveBeenCalled();
  expect(latestLogout).toHaveBeenCalledExactlyOnceWith('automatic');
  hook.unmount();
});
