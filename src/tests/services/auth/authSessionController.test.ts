// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  resolveAuthSessionState,
  toAnonymousAuthUser,
} from '@/services/auth/authSessionController';

describe('authSessionController', () => {
  it('maps anonymous users to viewer auth users', () => {
    expect(
      toAnonymousAuthUser({
        uid: 'anon-1',
      } as never)
    ).toEqual({
      uid: 'anon-1',
      email: null,
      displayName: 'Anonymous Doctor',
      role: 'viewer',
    });
  });

  it('returns explicit session state for anonymous signature users', async () => {
    const result = await resolveAuthSessionState(
      {
        uid: 'anon-signature',
        email: null,
        isAnonymous: true,
      } as never,
      {
        signOutUnauthorizedUser: vi.fn(),
        resolveFirebaseUserRole: vi.fn(),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'anonymous_signature',
        user: expect.objectContaining({
          uid: 'anon-signature',
          role: 'viewer',
        }),
      })
    );
  });

  it('returns resolved user for authorized standard users', async () => {
    const resolveFirebaseUserRole = vi.fn().mockResolvedValue('admin');

    const { user } = await resolveAuthSessionState(
      {
        uid: 'user-1',
        email: 'admin@hospital.cl',
        isAnonymous: false,
        displayName: 'Admin User',
      } as never,
      {
        signOutUnauthorizedUser: vi.fn(),
        resolveFirebaseUserRole,
      }
    );

    expect(user).toEqual(
      expect.objectContaining({
        uid: 'user-1',
        role: 'admin',
      })
    );
    expect(resolveFirebaseUserRole).toHaveBeenCalledTimes(1);
  });

  it('returns unauthorized session state for removed users', async () => {
    const signOutUnauthorizedUser = vi.fn().mockResolvedValue(undefined);

    const result = await resolveAuthSessionState(
      {
        uid: 'user-unauthorized',
        email: 'removed@hospital.cl',
        isAnonymous: false,
      } as never,
      {
        signOutUnauthorizedUser,
        resolveFirebaseUserRole: vi.fn().mockResolvedValue(null),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'unauthorized',
        user: null,
        reason: 'role_not_resolved',
      })
    );
    expect(signOutUnauthorizedUser).toHaveBeenCalledTimes(1);
  });
});
