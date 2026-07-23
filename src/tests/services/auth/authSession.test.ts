import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/services/auth/authSession');

const {
  mockOnAuthStateChanged,
  mockFirebaseSignOut,
  mockResolveFirebaseUserRole,
  mockClearRoleCacheForEmail,
  mockAuth,
} = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
  mockFirebaseSignOut: vi.fn().mockResolvedValue(undefined),
  mockResolveFirebaseUserRole: vi.fn(),
  mockClearRoleCacheForEmail: vi.fn().mockResolvedValue(undefined),
  mockAuth: { currentUser: null as null | { email: string | null } },
}));
let authStateCallback: ((firebaseUser: unknown) => Promise<void> | void) | null = null;

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  signOut: (...args: unknown[]) => mockFirebaseSignOut(...args),
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
}));

vi.mock('@/firebaseConfig', () => ({
  auth: mockAuth,
  firebaseReady: Promise.resolve(),
  getFunctionsInstance: vi.fn().mockReturnValue({}),
}));

vi.mock('@/services/auth/authPolicy', () => ({
  clearRoleCacheForEmail: (email: string) => mockClearRoleCacheForEmail(email),
}));

vi.mock('@/services/auth/authClaimSyncService', () => ({
  ensureUserRoleClaim: vi.fn().mockResolvedValue(undefined),
  resetAuthClaimSyncSnapshot: vi.fn(),
}));

vi.mock('@/services/auth/authAccessResolution', () => ({
  resolveFirebaseUserRole: (user: unknown) => mockResolveFirebaseUserRole(user),
  resolveFirebaseUserRoleForBootstrap: (user: unknown) => mockResolveFirebaseUserRole(user),
}));

import type { User } from 'firebase/auth';
import {
  getCurrentAuthSessionState,
  onAuthSessionStateChange,
  resolveCurrentAuthSessionState,
  shouldResolveObserverRoleStrictly,
  signOut,
} from '@/services/auth/authSession';
import { ensureUserRoleClaim } from '@/services/auth/authClaimSyncService';

const flushObserverRegistration = async (): Promise<void> => {
  await Promise.resolve();
};

const createFirebaseUserMock = (overrides: Record<string, unknown>) => ({
  uid: 'user-1',
  email: 'user@hospital.cl',
  displayName: 'User',
  photoURL: null,
  isAnonymous: false,
  getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
  ...overrides,
});

describe('authSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.currentUser = null;
    mockResolveFirebaseUserRole.mockResolvedValue('doctor_specialist');
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      authStateCallback = callback as (firebaseUser: unknown) => Promise<void> | void;
      return vi.fn();
    });
  });

  it('emits the authorized session state for general-login roles during auth state rehydration', async () => {
    const callback = vi.fn();
    onAuthSessionStateChange(callback);
    await flushObserverRegistration();

    await authStateCallback?.(
      createFirebaseUserMock({
        uid: 'spec-1',
        email: 'specialist@hospital.cl',
        displayName: 'Specialist User',
      })
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({
          uid: 'spec-1',
          role: 'doctor_specialist',
        }),
      })
    );
  });

  it('does not block auth callback while claim sync is still pending', async () => {
    let releaseClaimSync: (() => void) | undefined;
    vi.mocked(ensureUserRoleClaim).mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseClaimSync = resolve;
        })
    );

    const callback = vi.fn();
    onAuthSessionStateChange(callback);
    await flushObserverRegistration();

    await authStateCallback?.(
      createFirebaseUserMock({
        uid: 'spec-1',
        email: 'specialist@hospital.cl',
        displayName: 'Specialist User',
      })
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({
          uid: 'spec-1',
          role: 'doctor_specialist',
        }),
      })
    );

    releaseClaimSync?.();
  });

  it('emits unauthorized session state for a removed user', async () => {
    const callback = vi.fn();
    mockResolveFirebaseUserRole.mockResolvedValue(null);
    onAuthSessionStateChange(callback);
    await flushObserverRegistration();

    await authStateCallback?.(
      createFirebaseUserMock({
        uid: 'removed-1',
        email: 'removed@hospital.cl',
        displayName: 'Removed User',
      })
    );

    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unauthorized',
      })
    );
  });

  it('emits an auth_error session instead of signing out when role validation is temporarily unavailable', async () => {
    const callback = vi.fn();
    mockResolveFirebaseUserRole.mockRejectedValue(
      Object.assign(new Error('lookup unavailable'), {
        code: 'auth/role-validation-unavailable',
      })
    );

    onAuthSessionStateChange(callback);
    await flushObserverRegistration();

    await authStateCallback?.(
      createFirebaseUserMock({
        uid: 'user-temporary-error',
        email: 'user@hospital.cl',
      })
    );

    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'auth_error',
        error: expect.objectContaining({
          code: 'auth_session_state_resolution_failed',
        }),
      })
    );
  });

  it('emits anonymous signature session state explicitly', async () => {
    const callback = vi.fn();
    onAuthSessionStateChange(callback);
    await flushObserverRegistration();

    await authStateCallback?.(
      createFirebaseUserMock({
        uid: 'anon-1',
        email: null,
        displayName: null,
        isAnonymous: true,
      })
    );

    expect(mockResolveFirebaseUserRole).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'anonymous_signature',
        user: expect.objectContaining({
          uid: 'anon-1',
          role: 'viewer',
        }),
      })
    );
  });

  it('supports injected auth runtime seams for session helpers', async () => {
    const injectedAuth = { currentUser: { email: 'injected@hospital.cl' } };

    await signOut({
      authRuntime: {
        ready: Promise.resolve(),
        auth: injectedAuth as never,
        getCurrentUser: () => ({ email: 'injected@hospital.cl' }) as never,
      },
    });

    expect(mockFirebaseSignOut).toHaveBeenCalledWith(injectedAuth);
    expect(mockClearRoleCacheForEmail).toHaveBeenCalledWith('injected@hospital.cl');

    expect(
      getCurrentAuthSessionState({
        authRuntime: {
          ready: Promise.resolve(),
          auth: injectedAuth as never,
          getCurrentUser: () => null,
        },
      }).status
    ).toBe('unauthenticated');
  });

  it('resolves the current firebase session without waiting for the auth observer', async () => {
    mockResolveFirebaseUserRole.mockResolvedValueOnce('admin');

    const sessionState = await resolveCurrentAuthSessionState({
      authRuntime: {
        ready: Promise.resolve(),
        auth: mockAuth as never,
        getCurrentUser: () =>
          createFirebaseUserMock({
            uid: 'current-1',
            email: 'current@hospital.cl',
            displayName: 'Current User',
          }) as never,
      },
    });

    expect(sessionState).toEqual(
      expect.objectContaining({
        status: 'authorized',
        user: expect.objectContaining({
          uid: 'current-1',
          role: 'admin',
        }),
      })
    );
  });

  describe('shouldResolveObserverRoleStrictly', () => {
    const toUser = (overrides: Record<string, unknown>) =>
      createFirebaseUserMock(overrides) as unknown as User;

    beforeEach(() => {
      window.sessionStorage.clear();
    });

    it('resolves strictly during an active Google login attempt', () => {
      window.sessionStorage.setItem('hhr_google_login_attempt_pending', String(Date.now()));

      expect(shouldResolveObserverRoleStrictly(toUser({ metadata: {} }))).toBe(true);
    });

    it('resolves strictly for a sign-in completed moments ago even without the tab hint', () => {
      // Covers the post-timeout popup completion: the UI already cleared the
      // per-tab hint, but the Firebase sign-in itself is fresh.
      const user = toUser({
        metadata: { lastSignInTime: new Date(Date.now() - 60_000).toUTCString() },
      });

      expect(shouldResolveObserverRoleStrictly(user)).toBe(true);
    });

    it('allows the cached role for a plain session rehydration', () => {
      const user = toUser({
        metadata: { lastSignInTime: new Date(Date.now() - 60 * 60_000).toUTCString() },
      });

      expect(shouldResolveObserverRoleStrictly(user)).toBe(false);
    });

    it('allows the cached role when sign-in metadata is unavailable', () => {
      expect(shouldResolveObserverRoleStrictly(toUser({ metadata: {} }))).toBe(false);
    });
  });
});
