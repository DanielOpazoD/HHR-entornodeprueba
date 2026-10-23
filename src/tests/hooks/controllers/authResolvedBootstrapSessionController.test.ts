import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionState } from '@/types/authSessionTypes';
import { applyResolvedBootstrapSessionState } from '@/hooks/controllers/authResolvedBootstrapSessionController';

describe('authResolvedBootstrapSessionController', () => {
  const authorizedSession: AuthSessionState = {
    status: 'authorized',
    user: {
      uid: 'user-1',
      email: 'doctor@hospital.cl',
      displayName: 'Doctor',
      role: 'admin',
    },
  };

  it('applies an authenticated session and clears bootstrap state', () => {
    const setSessionState = vi.fn();
    const setAuthLoading = vi.fn();
    const markPerf = vi.fn();
    const clearAuthBootstrapPending = vi.fn();
    const clearRecentManualLogout = vi.fn();
    const restoreAuthBootstrapReturnTo = vi.fn();
    const markRecentAuthenticatedSessionHint = vi.fn();

    applyResolvedBootstrapSessionState({
      sessionState: authorizedSession,
      setSessionState,
      setAuthLoading,
      dependencies: {
        markPerf,
        isAuthBootstrapPending: () => true,
        restoreAuthBootstrapReturnTo,
        clearRecentManualLogout,
        clearAuthBootstrapPending,
        markRecentAuthenticatedSessionHint,
      },
    });

    expect(markRecentAuthenticatedSessionHint).toHaveBeenCalled();
    expect(markPerf).toHaveBeenCalledWith('auth-bootstrap:apply-session', 'authorized');
    expect(restoreAuthBootstrapReturnTo).toHaveBeenCalled();
    expect(clearRecentManualLogout).toHaveBeenCalled();
    expect(setSessionState).toHaveBeenCalledWith(authorizedSession);
    expect(setAuthLoading).toHaveBeenCalledWith(false);
    expect(clearAuthBootstrapPending).toHaveBeenCalled();
  });

  it('keeps the recent-logout marker and the session hint untouched while nobody is signed in', () => {
    const clearRecentManualLogout = vi.fn();
    const markRecentAuthenticatedSessionHint = vi.fn();

    applyResolvedBootstrapSessionState({
      sessionState: { status: 'unauthenticated', user: null } as AuthSessionState,
      setSessionState: vi.fn(),
      setAuthLoading: vi.fn(),
      dependencies: {
        markPerf: vi.fn(),
        isAuthBootstrapPending: () => false,
        restoreAuthBootstrapReturnTo: vi.fn(),
        clearRecentManualLogout,
        clearAuthBootstrapPending: vi.fn(),
        markRecentAuthenticatedSessionHint,
      },
    });

    expect(clearRecentManualLogout).not.toHaveBeenCalled();
    expect(markRecentAuthenticatedSessionHint).not.toHaveBeenCalled();
  });
});
