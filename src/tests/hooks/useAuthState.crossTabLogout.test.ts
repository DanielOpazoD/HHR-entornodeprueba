import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.unmock('@/hooks/useAuthState');

import { useAuthState } from '@/hooks/useAuthState';
import * as authSession from '@/services/auth/authSession';
import * as authFallback from '@/services/auth/authFallback';
import * as authUseCases from '@/application/auth/authSessionUseCases';

vi.mock('@/services/auth/authSession', () => ({
  onAuthSessionStateChange: vi.fn(),
  signOut: vi.fn(),
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
  clearSessionScopedClientState: vi.fn().mockResolvedValue(undefined),
  reconcileAuthorizedSessionOwner: vi.fn().mockResolvedValue(undefined),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

describe('useAuthState cross-tab logout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.mocked(authFallback.hasActiveFirebaseSession).mockReturnValue(false);
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(() => () => {});
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

  it('clears this tab’s persisted auth copy when another tab broadcasts a logout', async () => {
    sessionStorage.setItem('firebase:authUser:demo-key', JSON.stringify({ uid: 'u1' }));
    sessionStorage.setItem('hhr_logged_this_session', 'true');

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
});
