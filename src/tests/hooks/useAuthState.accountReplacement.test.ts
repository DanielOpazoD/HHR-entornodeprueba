import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.unmock('@/hooks/useAuthState');

import { useAuthState } from '@/hooks/useAuthState';
import { queryClient } from '@/config/queryClient';
import * as authSession from '@/services/auth/authSession';
import * as authFallback from '@/services/auth/authFallback';
import * as authUseCases from '@/application/auth/authSessionUseCases';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import type { AuthSessionState } from '@/types/authSessionTypes';

vi.mock('@/services/auth/authSession', () => ({
  onAuthSessionStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/services/auth/authFallback', () => ({
  hasActiveFirebaseSession: vi.fn(),
}));

vi.mock('@/application/auth/authSessionUseCases', () => ({
  executeRedirectAuthResolution: vi.fn(),
  executeResolvedCurrentAuthSessionState: vi.fn(),
}));

vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn(async (_reason: string, close?: () => Promise<void>) => {
    await close?.();
  }),
  reconcileAuthorizedSessionOwner: vi.fn().mockResolvedValue(undefined),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

/**
 * Logout clears the census cache, but Firebase can hand over a different authorized user
 * without one (another account signs in over the open one). The next person must not open on
 * the census the previous person had on screen.
 */
const CENSUS_KEY = ['dailyRecord', 'byDate', '2026-11-17'];
const authorized = (uid: string): AuthSessionState => ({
  status: 'authorized',
  user: {
    uid,
    displayName: 'Synthetic',
    email: `${uid}@accounts.hhr.invalid`,
    role: 'nurse_hospital',
  },
});

describe('useAuthState admits a different account without a logout', () => {
  let deliver: ((state: AuthSessionState) => void | Promise<void>) | null = null;

  const admit = async (
    result: { current: ReturnType<typeof useAuthState> },
    state: AuthSessionState
  ) => {
    await act(async () => {
      await deliver?.(state);
    });
    if (state.status === 'authorized')
      await waitFor(() => expect(result.current.authorizedUser?.uid).toBe(state.user.uid));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(
      (cb: (state: AuthSessionState) => void | Promise<void>) => {
        deliver = cb;
        void cb({ status: 'unauthenticated', user: null });
        return () => {};
      }
    );
    vi.mocked(authUseCases.executeRedirectAuthResolution).mockResolvedValue({
      status: 'success',
      data: null,
      issues: [],
    });
    vi.mocked(authUseCases.executeResolvedCurrentAuthSessionState).mockResolvedValue({
      status: 'success',
      data: null,
      issues: [],
    });
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    setFirestoreSyncState({ mode: 'enabled', reason: 'ready' });
  });

  it('opens the next account on an empty census cache', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await admit(result, authorized('hhrn_synthetic_a'));
    queryClient.setQueryData(CENSUS_KEY, { note: 'NOCHE SINTETICA A' });

    await admit(result, authorized('hhrn_synthetic_b'));

    expect(queryClient.getQueryData(CENSUS_KEY)).toBeUndefined();
  });

  it('also when the previous account dropped out without a logout in between', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await admit(result, authorized('hhrn_synthetic_a'));
    queryClient.setQueryData(CENSUS_KEY, { note: 'NOCHE SINTETICA A' });

    await admit(result, { status: 'unauthenticated', user: null });
    await admit(result, authorized('hhrn_synthetic_b'));

    expect(queryClient.getQueryData(CENSUS_KEY)).toBeUndefined();
  });

  it('keeps the census of the same account when it is admitted again', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await admit(result, authorized('hhrn_synthetic_a'));
    queryClient.setQueryData(CENSUS_KEY, { note: 'NOCHE SINTETICA A' });

    await admit(result, authorized('hhrn_synthetic_a'));

    expect(queryClient.getQueryData(CENSUS_KEY)).toEqual({ note: 'NOCHE SINTETICA A' });
  });
});
