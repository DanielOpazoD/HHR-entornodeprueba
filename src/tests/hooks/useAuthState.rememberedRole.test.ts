import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.unmock('@/hooks/useAuthState');

import { useAuthState } from '@/hooks/useAuthState';
import * as authSession from '@/services/auth/authSession';
import * as authFallback from '@/services/auth/authFallback';
import * as authUseCases from '@/application/auth/authSessionUseCases';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import type { AuthSessionState } from '@/types/authSessionTypes';
import * as sessionScopedStorageService from '@/services/storage/sessionScopedStorageService';

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

const setOnlineStatus = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
};

describe('useAuthState remembered-role revocation', () => {
  const AUTH_BOOTSTRAP_PENDING_KEY = 'hhr_auth_bootstrap_pending_v1';
  const RECENT_MANUAL_LOGOUT_KEY = 'hhr_recent_manual_logout_v1';
  let authSessionStateCallback: ((sessionState: AuthSessionState) => void | Promise<void>) | null =
    null;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(sessionScopedStorageService.clearSessionScopedClientState).mockImplementation(
      async (_reason, close) => {
        await close?.();
      }
    );
    authSessionStateCallback = null;
    window.sessionStorage.clear();
    window.localStorage.clear();
    localStorage.removeItem(AUTH_BOOTSTRAP_PENDING_KEY);
    sessionStorage.removeItem(AUTH_BOOTSTRAP_PENDING_KEY);
    sessionStorage.removeItem(RECENT_MANUAL_LOGOUT_KEY);

    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(
      (cb: (sessionState: AuthSessionState) => void | Promise<void>) => {
        authSessionStateCallback = cb;
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
    setFirestoreSyncState({
      mode: 'enabled',
      reason: 'ready',
    });

    setOnlineStatus(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses automatic session cleanup when a server denial follows remembered admission', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await act(async () => {
      await authSessionStateCallback?.({
        status: 'authorized',
        user: {
          uid: 'hhrn_synthetic',
          displayName: 'Synthetic',
          email: 'synthetic@accounts.hhr.invalid',
          role: 'nurse_hospital',
        },
      });
    });
    await waitFor(() => expect(result.current.authorizedUser?.uid).toBe('hhrn_synthetic'));
    await act(async () => {
      await authSessionStateCallback?.({
        status: 'unauthorized',
        user: null,
        reason: 'role_not_resolved',
      });
    });
    expect(result.current.authorizedUser).toBeNull();
    await waitFor(() =>
      expect(sessionScopedStorageService.clearSessionScopedClientState).toHaveBeenCalledWith(
        'automatic',
        expect.any(Function)
      )
    );
    expect(authSession.signOut).toHaveBeenCalled();
  });
});
