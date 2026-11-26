// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import type { AuthUser } from '@/types/authRoleTypes';

describe('authOperationalState', () => {
  it('provides safe unauthenticated defaults from sparse input', async () => {
    const normalized = resolveNormalizedAuthOperationalState({
      role: 'viewer',
    });

    expect(normalized.sessionState).toEqual({
      status: 'unauthenticated',
      user: null,
    });
    expect(normalized.currentUser).toBeNull();
    expect(normalized.authorizedUser).toBeNull();
    expect(normalized.authLoading).toBe(false);
    expect(normalized.isFirebaseConnected).toBe(false);
    expect(normalized.remoteSyncStatus).toBe('local_only');
    expect(normalized.remoteSyncState).toEqual({
      mode: 'local_only',
      reason: 'auth_unavailable',
    });
    expect(normalized.role).toBe('viewer');
    expect(normalized.isEditor).toBe(false);
    expect(normalized.isViewer).toBe(true);
    await expect(normalized.handleLogout()).resolves.toBeUndefined();
  });

  it('derives an authorized operational state from a user-only payload', () => {
    const currentUser: AuthUser = {
      uid: 'user-1',
      email: 'admin@hospital.cl',
      displayName: 'Admin User',
      role: 'admin',
    };
    const handleLogout = vi.fn();

    const normalized = resolveNormalizedAuthOperationalState({
      currentUser,
      authLoading: false,
      isFirebaseConnected: true,
      isOnline: true,
      handleLogout,
    });

    expect(normalized.sessionState).toEqual({
      status: 'authorized',
      user: currentUser,
    });
    expect(normalized.currentUser).toEqual(currentUser);
    expect(normalized.authorizedUser).toEqual(currentUser);
    expect(normalized.remoteSyncStatus).toBe('ready');
    expect(normalized.remoteSyncState).toEqual({
      mode: 'enabled',
      reason: 'ready',
    });
    expect(normalized.role).toBe('admin');
    expect(normalized.isEditor).toBe(true);
    expect(normalized.isViewer).toBe(false);
    expect(normalized.handleLogout).toBe(handleLogout);
  });

  it('rebuilds invalid runtime fragments instead of forwarding broken state', () => {
    const normalized = resolveNormalizedAuthOperationalState({
      sessionState: {
        status: 'authorized',
        user: {
          uid: 'user-2',
          email: 'viewer@hospital.cl',
          displayName: 'Viewer User',
          role: 'viewer',
        },
      },
      authLoading: false,
      isFirebaseConnected: false,
      isOnline: false,
      remoteSyncState: { mode: 'enabled' } as never,
      remoteSyncStatus: 'invalid' as never,
      authRuntime: { isFirebaseConnected: false } as never,
    });

    expect(normalized.remoteSyncStatus).toBe('local_only');
    expect(normalized.remoteSyncState).toEqual({
      mode: 'local_only',
      reason: 'offline',
    });
    expect(normalized.authRuntime.isOnline).toBe(false);
    expect(normalized.authRuntime.isFirebaseConnected).toBe(false);
    expect(normalized.authRuntime.sessionStatus).toBe('authorized');
  });
});
