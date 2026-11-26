// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthContextValue,
  buildNormalizedAuthOperationalStateInput,
} from '@/context/authContextController';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import type { AuthUser } from '@/types/authRoleTypes';

describe('authContextController', () => {
  it('maps useAuthState output into normalized auth operational input', () => {
    const handleLogout = vi.fn();
    const authState: Parameters<typeof buildNormalizedAuthOperationalStateInput>[0] = {
      sessionState: { status: 'unauthenticated', user: null },
      currentUser: null,
      authorizedUser: null,
      authLoading: false,
      isFirebaseConnected: true,
      remoteSyncStatus: 'ready',
      remoteSyncState: { mode: 'enabled', reason: 'ready' },
      authRuntime: {
        sessionStatus: 'unauthenticated',
        authLoading: false,
        isFirebaseConnected: true,
        isOnline: true,
        bootstrapPending: false,
        pendingAgeMs: 0,
        budgetProfile: 'default',
        timeoutMs: 0,
        runtimeState: 'ok',
        issues: [],
      },
      role: 'admin',
      handleLogout,
    };

    expect(buildNormalizedAuthOperationalStateInput(authState)).toEqual({
      sessionState: authState.sessionState,
      currentUser: null,
      authorizedUser: null,
      authLoading: false,
      isFirebaseConnected: true,
      remoteSyncStatus: 'ready',
      remoteSyncState: { mode: 'enabled', reason: 'ready' },
      authRuntime: authState.authRuntime,
      role: 'admin',
      handleLogout,
    });
  });

  it('derives auth context flags from normalized operational state', () => {
    const user: AuthUser = {
      uid: 'doctor-1',
      email: 'doctor@hrr.cl',
      displayName: 'Dra. Clinica',
      role: 'doctor_urgency',
    };
    const signOut = vi.fn();

    const context = buildAuthContextValue(
      resolveNormalizedAuthOperationalState({
        sessionState: {
          status: 'authorized',
          user,
        },
        currentUser: user,
        role: 'doctor_urgency',
        handleLogout: signOut,
      })
    );

    expect(context.isAuthenticated).toBe(true);
    expect(context.isAuthorizedSession).toBe(true);
    expect(context.isEditor).toBe(true);
    expect(context.isViewer).toBe(false);
    expect(context.signOut).toBe(signOut);
  });
});
