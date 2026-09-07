import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeCurrentFirebaseUser,
  authorizeFirebaseUser,
  resolveFirebaseUserRoleForBootstrap,
  resolveFirebaseUserRole,
} from '@/services/auth/authAccessResolution';

const {
  mockFirebaseSignOut,
  mockResolveGeneralLoginAccessForEmail,
  mockResolveUserRoleClaim,
  mockAuth,
  mockToAuthUser,
} = vi.hoisted(() => ({
  mockFirebaseSignOut: vi.fn().mockResolvedValue(undefined),
  mockResolveGeneralLoginAccessForEmail: vi.fn(),
  mockResolveUserRoleClaim: vi.fn(),
  mockAuth: {
    currentUser: null as null | { uid: string; email: string | null; isAnonymous?: boolean },
  },
  mockToAuthUser: vi.fn((user: { uid: string; email: string | null }, role?: string) => ({
    uid: user.uid,
    email: user.email,
    role,
  })),
}));

vi.mock('firebase/auth', () => ({
  signOut: () => mockFirebaseSignOut(),
}));

vi.mock('@/firebaseConfig', () => ({
  auth: mockAuth,
  firebaseReady: Promise.resolve(),
}));

vi.mock('@/services/auth/authPolicy', () => ({
  resolveGeneralLoginAccessForEmail: (email: string, options?: unknown) =>
    options === undefined
      ? mockResolveGeneralLoginAccessForEmail(email)
      : mockResolveGeneralLoginAccessForEmail(email, options),
}));

vi.mock('@/services/auth/authShared', () => ({
  toAuthUser: (user: { uid: string; email: string | null }, role?: string) =>
    mockToAuthUser(user, role),
  createAuthError: (code: string, message: string) => Object.assign(new Error(message), { code }),
}));

vi.mock('@/services/auth/authClaimSyncService', () => ({
  resolveUserRoleClaim: (user: unknown) => mockResolveUserRoleClaim(user),
}));

describe('authAccessResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.currentUser = null;
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: true,
      role: 'admin',
      resolution: 'authorized',
    });
    mockResolveUserRoleClaim.mockResolvedValue(null);
  });

  it('authorizes doctor_specialist users in the standard login flow', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: true,
      role: 'doctor_specialist',
      resolution: 'authorized',
    });

    const result = await authorizeFirebaseUser({
      uid: 'spec-1',
      email: 'specialist@hospital.cl',
    } as never);

    expect(result).toEqual({
      uid: 'spec-1',
      email: 'specialist@hospital.cl',
      role: 'doctor_specialist',
    });
    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
  });

  it('signs out unauthorized users in the standard login flow', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: false,
      role: undefined,
      resolution: 'unauthorized',
    });

    await expect(
      authorizeFirebaseUser({
        uid: 'doctor-1',
        email: 'doctor@hospital.cl',
      } as never)
    ).rejects.toThrow(/Acceso no autorizado/i);

    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it('does not sign out a replacement session after a discarded pilot lookup', async () => {
    let finish!: (value: unknown) => void;
    let current = true;
    mockResolveGeneralLoginAccessForEmail.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const pending = authorizeFirebaseUser({ uid: 'old', email: 'old@hospital.cl' } as never, {
      isCurrent: () => current,
    });
    current = false;
    finish({ allowed: false, resolution: 'unauthorized' });
    await expect(pending).rejects.toMatchObject({ code: 'auth/cancelled-popup-request' });
    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
  });

  it('signs out users with null email in the standard login flow', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: false,
      role: undefined,
      resolution: 'unauthorized',
    });

    await expect(
      authorizeFirebaseUser({
        uid: 'no-email-1',
        email: null,
      } as never)
    ).rejects.toThrow(/Acceso no autorizado/i);

    expect(mockResolveGeneralLoginAccessForEmail).toHaveBeenCalledWith('');
    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it('rehydrates an authorized current user without exposing an empty shell', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: true,
      role: 'doctor_specialist',
      resolution: 'authorized',
    });

    await expect(
      authorizeCurrentFirebaseUser({
        authRuntime: {
          ready: Promise.resolve(),
          auth: mockAuth as never,
          getCurrentUser: () =>
            ({
              uid: 'spec-2',
              email: 'specialist@hospital.cl',
              isAnonymous: false,
            }) as never,
        },
      })
    ).resolves.toEqual({
      uid: 'spec-2',
      email: 'specialist@hospital.cl',
      role: 'doctor_specialist',
    });
  });

  it('returns null after sign-out when the rehydrated current user no longer has a role', async () => {
    mockAuth.currentUser = {
      uid: 'removed-1',
      email: 'removed@hospital.cl',
      isAnonymous: false,
    };
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: false,
      role: undefined,
      resolution: 'unauthorized',
    });

    await expect(authorizeCurrentFirebaseUser()).resolves.toBeNull();
    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it('reuses the current token role when config lookup is temporarily unavailable', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: false,
      role: undefined,
      resolution: 'unavailable',
    });
    mockResolveUserRoleClaim.mockResolvedValue('doctor_specialist');

    const user = {
      uid: 'fallback-1',
      email: 'fallback@hospital.cl',
    } as never;

    await expect(authorizeFirebaseUser(user)).resolves.toEqual({
      uid: 'fallback-1',
      email: 'fallback@hospital.cl',
      role: 'doctor_specialist',
    });
    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
  });

  it('does not sign out when role validation is unavailable and no claim fallback exists', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: false,
      role: undefined,
      resolution: 'unavailable',
    });

    await expect(
      authorizeFirebaseUser({
        uid: 'fallback-2',
        email: 'fallback@hospital.cl',
      } as never)
    ).rejects.toMatchObject({
      code: 'auth/role-validation-unavailable',
    });

    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
  });

  it('rehydrates the role from token claims when backend validation is temporarily unavailable', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: false,
      role: undefined,
      resolution: 'unavailable',
    });
    mockResolveUserRoleClaim.mockResolvedValue('doctor_specialist');

    await expect(
      resolveFirebaseUserRole({
        uid: 'fallback-3',
        email: 'fallback@hospital.cl',
      } as never)
    ).resolves.toBe('doctor_specialist');
  });

  it('allows cached role resolution only in the bootstrap rehydration path', async () => {
    mockResolveGeneralLoginAccessForEmail.mockResolvedValue({
      allowed: true,
      role: 'admin',
      resolution: 'authorized',
    });

    await expect(
      resolveFirebaseUserRoleForBootstrap({
        uid: 'bootstrap-1',
        email: 'bootstrap@hospital.cl',
      } as never)
    ).resolves.toBe('admin');

    expect(mockResolveGeneralLoginAccessForEmail).toHaveBeenCalledWith('bootstrap@hospital.cl', {
      allowCachedRole: true,
    });
  });
});
