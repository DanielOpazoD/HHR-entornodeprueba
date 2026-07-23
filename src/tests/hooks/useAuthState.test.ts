import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.unmock('@/hooks/useAuthState');

import { useAuthState } from '@/hooks/useAuthState';
import * as authSession from '@/services/auth/authSession';
import * as authFallback from '@/services/auth/authFallback';
import * as authUseCases from '@/application/auth/authSessionUseCases';
import * as auditService from '@/services/admin/auditService';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser, UserRole } from '@/types/authRoleTypes';
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

vi.mock('@/services/admin/auditService', () => ({
  logUserLogin: vi.fn(),
  logUserLogout: vi.fn(),
}));

vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn().mockResolvedValue(undefined),
  reconcileAuthorizedSessionOwner: vi.fn().mockResolvedValue(undefined),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

const setOnlineStatus = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
};

describe('useAuthState baseline', () => {
  const AUTH_BOOTSTRAP_PENDING_KEY = 'hhr_auth_bootstrap_pending_v1';
  const RECENT_MANUAL_LOGOUT_KEY = 'hhr_recent_manual_logout_v1';
  let authSessionStateCallback: ((sessionState: AuthSessionState) => void | Promise<void>) | null =
    null;

  beforeEach(() => {
    vi.resetAllMocks();
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

  it('should initialize and handle login', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    const user: AuthUser = {
      uid: 'u123',
      email: 'test@hhr.cl',
      role: 'editor' as UserRole,
      displayName: 'Test Editor',
    };

    await act(async () => {
      await authSessionStateCallback?.({
        status: 'authorized',
        user,
      });
    });

    await waitFor(() => expect(result.current.user?.uid).toBe('u123'));
    expect(result.current.isEditor).toBe(true);
    await waitFor(() =>
      expect(sessionScopedStorageService.reconcileAuthorizedSessionOwner).toHaveBeenCalledWith(
        'user:u123'
      )
    );
  });

  it('treats doctor_specialist as editor-capable for restricted medical handoff editing', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    const user: AuthUser = {
      uid: 'specialist-1',
      email: 'specialist@hhr.cl',
      role: 'doctor_specialist',
      displayName: 'Especialista',
    };

    await act(async () => {
      await authSessionStateCallback?.({
        status: 'authorized',
        user,
      });
    });

    await waitFor(() => expect(result.current.user?.uid).toBe('specialist-1'));
    expect(result.current.role).toBe('doctor_specialist');
    expect(result.current.isEditor).toBe(true);
  });

  it('should handle manual logout', async () => {
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    await act(async () => {
      await authSessionStateCallback?.({
        status: 'authorized',
        user: {
          uid: 'u1',
          email: 't@t.com',
          role: 'admin' as UserRole,
          displayName: 'Admin',
        },
      });
    });

    await act(async () => {
      await result.current.handleLogout('manual');
    });

    await waitFor(() => expect(result.current.user).toBe(null));
    expect(authSession.signOut).toHaveBeenCalled();
    expect(sessionStorage.getItem(RECENT_MANUAL_LOGOUT_KEY)).toBeTruthy();
    await waitFor(() =>
      expect(sessionScopedStorageService.clearSessionScopedClientState).toHaveBeenCalledWith(
        'manual'
      )
    );
  });

  it('clears this tab’s persisted auth copy when another tab broadcasts a logout', async () => {
    sessionStorage.setItem('firebase:authUser:demo-key', JSON.stringify({ uid: 'u1' }));
    sessionStorage.setItem('hhr_logged_this_session', 'true');
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      const channel = new BroadcastChannel('hhr_auth_channel');
      channel.postMessage({ type: 'LOGOUT', reason: 'manual', tabId: 'other-tab' });
      channel.close();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(result.current.user).toBe(null));
    expect(sessionStorage.getItem('firebase:authUser:demo-key')).toBeNull();
    expect(sessionStorage.getItem('hhr_logged_this_session')).toBeNull();
  });

  it('should skip auth loading after a recent manual logout when no firebase session remains', async () => {
    sessionStorage.setItem(
      RECENT_MANUAL_LOGOUT_KEY,
      JSON.stringify({ reason: 'manual', at: Date.now() })
    );
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.authLoading).toBe(false));
  });

  it('starts directly on the unauthenticated login state when local reset removed every auth signal', () => {
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});
    vi.mocked(authUseCases.executeRedirectAuthResolution).mockImplementationOnce(
      () => new Promise(() => {})
    );
    vi.mocked(authUseCases.executeResolvedCurrentAuthSessionState).mockImplementationOnce(
      () => new Promise(() => {})
    );

    const { result } = renderHook(() => useAuthState());

    expect(result.current.authLoading).toBe(false);
    expect(result.current.sessionState).toEqual({
      status: 'unauthenticated',
      user: null,
    });
  });

  it('keeps the app in auth bootstrap on same-tab refresh while a prior valid login is rehydrating', () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});
    vi.mocked(authUseCases.executeRedirectAuthResolution).mockImplementationOnce(
      () => new Promise(() => {})
    );
    vi.mocked(authUseCases.executeResolvedCurrentAuthSessionState).mockImplementationOnce(
      () => new Promise(() => {})
    );

    const { result } = renderHook(() => useAuthState());

    expect(result.current.authLoading).toBe(true);
    expect(result.current.sessionState).toEqual({
      status: 'authenticating',
      user: null,
    });
  });

  it('should handle inactivity timeout', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      vi.advanceTimersByTime(16000);
    });

    expect(result.current.authLoading).toBe(false);

    const user: AuthUser = {
      uid: 'u1',
      email: 't@t.com',
      role: 'admin' as UserRole,
      displayName: 'Admin',
    };

    await act(async () => {
      await authSessionStateCallback?.({
        status: 'authorized',
        user,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(61 * 60 * 1000);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.user).toBe(null);
    expect(auditService.logUserLogout).toHaveBeenCalledWith('t@t.com', 'automatic');
  });

  it('should handle network status switches', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAuthState());

    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(true);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.isFirebaseConnected).toBe(true);

    setOnlineStatus(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.isFirebaseConnected).toBe(false);

    setOnlineStatus(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.isFirebaseConnected).toBe(true);
  });

  it('recovers remote sync readiness after an early local_only snapshot', async () => {
    setFirestoreSyncState({
      mode: 'local_only',
      reason: 'auth_unavailable',
    });

    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    expect(result.current.remoteSyncStatus).toBe('local_only');

    const user: AuthUser = {
      uid: 'u123',
      email: 'test@hhr.cl',
      role: 'editor' as UserRole,
      displayName: 'Test Editor',
    };

    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(true);

    await act(async () => {
      await authSessionStateCallback?.({
        status: 'authorized',
        user,
      });
    });

    await waitFor(() => expect(result.current.isFirebaseConnected).toBe(true));
    await waitFor(() => expect(result.current.remoteSyncStatus).toBe('ready'));
  });

  it('extends auth bootstrap timeout while redirect login is pending', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(
      AUTH_BOOTSTRAP_PENDING_KEY,
      JSON.stringify({ startedAt: Date.now(), mode: 'redirect' })
    );

    // Simulate Firebase not notifying auth state yet.
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      vi.advanceTimersByTime(16000);
    });

    expect(result.current.authLoading).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.authLoading).toBe(false);
    expect(sessionStorage.getItem(AUTH_BOOTSTRAP_PENDING_KEY)).toBeNull();
  });

  it('hydrates user from redirect result before auth subscription resolves', async () => {
    sessionStorage.setItem(
      AUTH_BOOTSTRAP_PENDING_KEY,
      JSON.stringify({ startedAt: Date.now(), mode: 'redirect' })
    );
    const redirectUser: AuthUser = {
      uid: 'redirect-1',
      email: 'redirect@hhr.cl',
      role: 'viewer' as UserRole,
      displayName: 'Redirect User',
    };

    vi.mocked(authUseCases.executeRedirectAuthResolution).mockResolvedValueOnce({
      status: 'success',
      data: {
        status: 'authorized',
        user: redirectUser,
      },
      issues: [],
    });
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    expect(result.current.user?.uid).toBe('redirect-1');
    expect(result.current.role).toBe('viewer');
  });

  it('hydrates user from the current firebase session before auth observer resolves', async () => {
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(true);
    const existingUser: AuthUser = {
      uid: 'existing-1',
      email: 'existing@hhr.cl',
      role: 'admin',
      displayName: 'Existing User',
    };

    vi.mocked(authUseCases.executeResolvedCurrentAuthSessionState).mockResolvedValueOnce({
      status: 'success',
      data: {
        status: 'authorized',
        user: existingUser,
      },
      issues: [],
    });
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    expect(result.current.user?.uid).toBe('existing-1');
    expect(result.current.role).toBe('admin');
  });

  it('keeps auth loading active until direct current-session hydration resolves', async () => {
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(true);
    let resolveCurrentSession:
      | ((
          value: Awaited<ReturnType<typeof authUseCases.executeResolvedCurrentAuthSessionState>>
        ) => void)
      | null = null;

    vi.mocked(authUseCases.executeResolvedCurrentAuthSessionState).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveCurrentSession = resolve;
        })
    );
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.authLoading).toBe(true);

    await act(async () => {
      resolveCurrentSession?.({
        status: 'success',
        data: {
          status: 'authorized',
          user: {
            uid: 'current-1',
            email: 'current@hhr.cl',
            role: 'editor',
            displayName: 'Current User',
          },
        },
        issues: [],
      });
    });

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    expect(result.current.user?.uid).toBe('current-1');
    expect(result.current.role).toBe('editor');
  });

  it('keeps bootstrap active when same-tab history is still present after direct checks are empty', async () => {
    window.sessionStorage.setItem('hhr_logged_this_session', 'true');
    window.localStorage.setItem('firebase:authUser:test:[DEFAULT]', '{"uid":"stale-user"}');
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});

    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.authLoading).toBe(true);
    expect(result.current.sessionState).toEqual({
      status: 'authenticating',
      user: null,
    });
  });

  it('should keep anonymous signature-mode users when Firebase returns one', async () => {
    const { result } = renderHook(() => useAuthState());

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    await act(async () => {
      await authSessionStateCallback?.({
        status: 'anonymous_signature',
        user: {
          uid: 'anon-signature',
          email: null,
          role: 'viewer' as UserRole,
          displayName: 'Firma',
        },
      });
    });

    await waitFor(() => expect(result.current.user?.uid).toBe('anon-signature'));
    expect(result.current.role).toBe('viewer');
    expect(result.current.sessionState.status).toBe('anonymous_signature');
  });
});
