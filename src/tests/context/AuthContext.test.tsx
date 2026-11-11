import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.unmock('@/context/AuthContext');

import { buildAuthContextValue } from '@/context/AuthContext';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import type { AuthUser } from '@/types/authRoleTypes';

describe('AuthContext', () => {
  it('builds safe defaults from sparse auth input', async () => {
    const authContext = buildAuthContextValue(
      resolveNormalizedAuthOperationalState({
        role: 'viewer',
      })
    );

    expect(authContext.sessionState).toEqual({
      status: 'unauthenticated',
      user: null,
    });
    expect(authContext.currentUser).toBeNull();
    expect(authContext.authorizedUser).toBeNull();
    expect(authContext.isAuthenticated).toBe(false);
    expect(authContext.isAuthorizedSession).toBe(false);
    expect(authContext.isViewer).toBe(true);
    expect(authContext.remoteSyncStatus).toBe('local_only');
    expect(authContext.remoteSyncState).toEqual({
      mode: 'local_only',
      reason: 'auth_unavailable',
    });
    await expect(authContext.signOut()).resolves.toBeUndefined();
  });

  it('maps an authorized operational state into editor-capable context flags', () => {
    const user: AuthUser = {
      uid: 'admin-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin',
      role: 'admin',
    };
    const handleLogout = vi.fn();

    const authContext = buildAuthContextValue(
      resolveNormalizedAuthOperationalState({
        sessionState: {
          status: 'authorized',
          user,
        },
        currentUser: user,
        authorizedUser: user,
        authLoading: false,
        isFirebaseConnected: true,
        isOnline: true,
        role: 'admin',
        handleLogout,
      })
    );

    expect(authContext.isAuthenticated).toBe(true);
    expect(authContext.isAuthorizedSession).toBe(true);
    expect(authContext.currentUser?.uid).toBe('admin-1');
    expect(authContext.role).toBe('admin');
    expect(authContext.isEditor).toBe(true);
    expect(authContext.isViewer).toBe(false);
    expect(authContext.signOut).toBe(handleLogout);
  });
});

// The session provider must be usable without importing application presentation.
it('keeps handoff presentation out of the session provider', () => {
  const source = readFileSync('src/context/AuthContext.tsx', 'utf8');
  expect(source).not.toMatch(/@\/components\//);
});
