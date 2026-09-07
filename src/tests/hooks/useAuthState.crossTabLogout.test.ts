import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.unmock('@/hooks/useAuthState');

import { useAuthState } from '@/hooks/useAuthState';
import * as authSession from '@/services/auth/authSession';
import * as authFallback from '@/services/auth/authFallback';
import * as authUseCases from '@/application/auth/authSessionUseCases';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import type { AuthChannelMessage } from '@/services/auth/authBroadcastChannel';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

let emitAuthChannelMessage: ((message: AuthChannelMessage) => void) | undefined;

vi.mock('@/services/auth/authSession', () => ({
  onAuthSessionStateChange: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/auth/authFallback', () => ({
  hasActiveFirebaseSession: vi.fn(),
}));

vi.mock('@/application/auth/authSessionUseCases', () => ({
  executeRedirectAuthResolution: vi
    .fn()
    .mockResolvedValue({ status: 'success', data: null, issues: [] }),
  executeResolvedCurrentAuthSessionState: vi
    .fn()
    .mockResolvedValue({ status: 'success', data: null, issues: [] }),
}));

vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn(async (_reason: string, close?: () => Promise<void>) => {
    await close?.();
  }),
  reconcileAuthorizedSessionOwner: vi.fn().mockResolvedValue(undefined),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

vi.mock('@/services/auth/authBroadcastChannel', () => ({
  broadcastLogout: vi.fn(),
  broadcastSessionActivity: vi.fn(),
  onAuthChannelMessage: vi.fn((callback: (message: AuthChannelMessage) => void) => {
    emitAuthChannelMessage = callback;
    return () => {
      if (emitAuthChannelMessage === callback) emitAuthChannelMessage = undefined;
    };
  }),
}));

describe('useAuthState cross-tab logout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(clearSessionScopedClientState).mockImplementation(async (_reason, close) => {
      await close?.();
    });
    emitAuthChannelMessage = undefined;
    window.sessionStorage.clear();
    window.localStorage.clear();
    setSessionGeneration(null);
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});
    vi.mocked(authSession.signOut).mockResolvedValue(undefined);
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
  });

  it('does not expose an authorized user until storage admission completes', async () => {
    let admit!: () => void;
    vi.mocked(reconcileAuthorizedSessionOwner).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          admit = resolve;
        })
    );
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await act(async () => {
      await vi
        .mocked(authSession.onAuthSessionStateChange)
        .mock.calls.at(-1)![0]({
          status: 'authorized',
          user: { uid: 'new', email: 'test@hhr.cl', role: 'editor', displayName: 'Test' },
        });
    });
    expect(result.current.authorizedUser).toBeNull();
    expect(result.current.authLoading).toBe(true);
    await act(async () => {
      admit();
    });
    expect(result.current.authorizedUser?.uid).toBe('new');
  });

  it('does not resurrect an admission that completes after logout', async () => {
    let admit!: () => void;
    vi.mocked(reconcileAuthorizedSessionOwner).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          admit = resolve;
        })
    );
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await act(async () => {
      await vi
        .mocked(authSession.onAuthSessionStateChange)
        .mock.calls.at(-1)![0]({
          status: 'authorized',
          user: { uid: 'old', email: 'test@hhr.cl', role: 'editor', displayName: 'Test' },
        });
    });
    await act(async () => {
      await result.current.handleLogout();
      admit();
    });
    expect(result.current.authorizedUser).toBeNull();
    expect(result.current.sessionState.status).toBe('unauthenticated');
  });

  it('does not invalidate a pending admission when storage rejects a stale remote closure', async () => {
    let admit!: () => void;
    vi.mocked(reconcileAuthorizedSessionOwner).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          admit = resolve;
        })
    );
    // The storage boundary owns the generation decision and deliberately never
    // invokes the closure when the replacement has already been admitted.
    vi.mocked(clearSessionScopedClientState).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await act(async () => {
      await vi
        .mocked(authSession.onAuthSessionStateChange)
        .mock.calls.at(-1)![0]({
          status: 'authorized',
          user: { uid: 'new', email: 'test@hhr.cl', role: 'editor', displayName: 'Test' },
        });
      emitAuthChannelMessage?.({
        type: 'LOGOUT',
        reason: 'manual',
        tabId: 'old-tab',
        generation: 'old',
      });
    });
    await act(async () => {
      admit();
    });
    expect(result.current.authorizedUser?.uid).toBe('new');
    expect(authSession.signOut).not.toHaveBeenCalled();
  });

  it('delegates generation decisions while a replacement admission is pending', async () => {
    setSessionGeneration('previous');
    let admit!: () => void;
    vi.mocked(reconcileAuthorizedSessionOwner).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          admit = resolve;
        })
    );
    const { result } = renderHook(() => useAuthState());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    await act(async () => {
      await vi
        .mocked(authSession.onAuthSessionStateChange)
        .mock.calls.at(-1)![0]({
          status: 'authorized',
          user: { uid: 'new', email: 'test@hhr.cl', role: 'editor', displayName: 'Test' },
        });
      emitAuthChannelMessage?.({
        type: 'LOGOUT',
        reason: 'manual',
        tabId: 'other-tab',
        generation: 'replacement',
      });
    });
    await act(async () => {
      admit();
    });
    expect(clearSessionScopedClientState).toHaveBeenCalledWith(
      'manual',
      expect.any(Function),
      'replacement'
    );
    expect(authSession.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.authorizedUser).toBeNull();
  });

  it('clears this tab’s persisted auth copy when another tab broadcasts a logout', async () => {
    sessionStorage.setItem('firebase:authUser:demo-key', JSON.stringify({ uid: 'u1' }));
    sessionStorage.setItem('hhr_logged_this_session', 'true');

    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      emitAuthChannelMessage?.({ type: 'LOGOUT', reason: 'manual', tabId: 'other-tab' });
    });

    await waitFor(() => expect(authSession.signOut).toHaveBeenCalledTimes(1));
    expect(result.current.user).toBe(null);
    expect(sessionStorage.getItem('firebase:authUser:demo-key')).toBeNull();
    expect(sessionStorage.getItem('hhr_logged_this_session')).toBeNull();
    expect(clearSessionScopedClientState).toHaveBeenCalledWith(
      'manual',
      expect.any(Function),
      undefined
    );
  });
});
