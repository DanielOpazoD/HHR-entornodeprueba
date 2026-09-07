import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/services/auth/authSession');

const {
  mockOnAuthStateChanged,
  mockFirebaseSignOut,
  mockResolveFirebaseUserRole,
  mockResolveFirebaseUserRoleForBootstrap,
  mockClearRoleCacheForEmail,
  mockAuth,
} = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
  mockFirebaseSignOut: vi.fn().mockResolvedValue(undefined),
  mockResolveFirebaseUserRole: vi.fn(),
  mockResolveFirebaseUserRoleForBootstrap: vi.fn(),
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
  resolveFirebaseUserRoleForBootstrap: (user: unknown) =>
    mockResolveFirebaseUserRoleForBootstrap(user),
}));

import {
  getCurrentAuthSessionState,
  onAuthSessionStateChange,
  resolveCurrentAuthSessionState,
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
    mockResolveFirebaseUserRoleForBootstrap.mockResolvedValue('doctor_specialist');
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      authStateCallback = callback as (firebaseUser: unknown) => Promise<void> | void;
      return vi.fn();
    });
  });

  it.each(['unmount', 'new-user', 'logout', 'denied-old-user'])(
    'ignores a delayed old role after %s',
    async mode => {
      let finish!: (role: string | null) => void;
      mockResolveFirebaseUserRole.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      );
      const callback = vi.fn();
      const unsubscribe = onAuthSessionStateChange(callback);
      await flushObserverRegistration();
      const old = authStateCallback?.(createFirebaseUserMock({ uid: 'old' }));
      if (mode === 'unmount') unsubscribe();
      else if (mode === 'logout') await signOut();
      else await authStateCallback?.(createFirebaseUserMock({ uid: 'new' }));
      callback.mockClear();
      vi.mocked(ensureUserRoleClaim).mockClear();
      mockFirebaseSignOut.mockClear();
      finish(mode === 'denied-old-user' ? null : 'admin');
      await old;
      expect(callback).not.toHaveBeenCalled();
      expect(ensureUserRoleClaim).not.toHaveBeenCalled();
      expect(mockFirebaseSignOut).not.toHaveBeenCalled();
      unsubscribe();
    }
  );

  it('discards an old bootstrap result when the current user changes', async () => {
    let finish!: (role: string) => void;
    mockResolveFirebaseUserRoleForBootstrap.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    let current = createFirebaseUserMock({ uid: 'old' });
    const pending = resolveCurrentAuthSessionState({
      authRuntime: {
        ready: Promise.resolve(),
        auth: mockAuth as never,
        getCurrentUser: () => current as never,
      },
    });
    await Promise.resolve();
    current = createFirebaseUserMock({ uid: 'new' });
    finish('admin');
    expect(await pending).toBeNull();
    expect(ensureUserRoleClaim).not.toHaveBeenCalled();
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
    expect(mockResolveFirebaseUserRole).toHaveBeenCalledTimes(1);
    expect(mockResolveFirebaseUserRoleForBootstrap).not.toHaveBeenCalled();
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
    mockResolveFirebaseUserRoleForBootstrap.mockResolvedValueOnce('admin');
    const currentUser = createFirebaseUserMock({
      uid: 'current-1',
      email: 'current@hospital.cl',
      displayName: 'Current User',
    });

    const sessionState = await resolveCurrentAuthSessionState({
      authRuntime: {
        ready: Promise.resolve(),
        auth: mockAuth as never,
        getCurrentUser: () => currentUser as never,
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
    expect(mockResolveFirebaseUserRoleForBootstrap).toHaveBeenCalledTimes(1);
    expect(mockResolveFirebaseUserRole).not.toHaveBeenCalled();
  });
});
