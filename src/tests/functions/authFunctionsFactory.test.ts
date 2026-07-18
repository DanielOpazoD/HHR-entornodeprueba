import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
  auth: {
    user: () => ({
      onCreate: (handler: (user: unknown) => unknown) => ({ run: handler }),
    }),
  },
}));

const require = createRequire(import.meta.url);
const { createAuthFunctions } = require('../../../functions/lib/auth/authFunctionsFactory.js');

describe('functions authFunctionsFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects role mutation without admin access', async () => {
    const functionsApi = createAuthFunctions({
      auth: {
        getUserByEmail: vi.fn(),
        setCustomUserClaims: vi.fn(),
      },
      helpers: {
        normalizeEmail: (value: unknown) => String(value || '').toLowerCase(),
      },
    });

    await expect(functionsApi.setUserRole.run({}, { auth: null })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('delegates user creation role assignment to helper', async () => {
    const assignRole = vi.fn().mockResolvedValue('admin');
    const functionsApi = createAuthFunctions({
      auth: {
        getUserByEmail: vi.fn(),
        setCustomUserClaims: vi.fn(),
      },
      helpers: {
        assignRole,
        normalizeEmail: (value: unknown) => String(value || '').toLowerCase(),
        resolveRoleForEmail: vi.fn(),
      },
    });

    await expect(
      functionsApi.onUserCreated.run({ uid: 'u1', email: 'user@example.com' })
    ).resolves.toBe('admin');
    expect(assignRole).toHaveBeenCalledWith({ uid: 'u1', email: 'user@example.com' });
  });

  it('syncs current user role claim from config/roles for the caller', async () => {
    const getUser = vi.fn().mockResolvedValue({ customClaims: { featureFlag: true } });
    const setCustomUserClaims = vi.fn().mockResolvedValue(undefined);
    const resolveRoleForEmail = vi.fn().mockResolvedValue('admin');
    const functionsApi = createAuthFunctions({
      auth: {
        getUserByEmail: vi.fn(),
        getUser,
        setCustomUserClaims,
      },
      helpers: {
        assignRole: vi.fn(),
        normalizeEmail: (value: unknown) => String(value || '').toLowerCase(),
        resolveRoleForEmail,
      },
    });

    const result = await functionsApi.syncCurrentUserRoleClaim.run(
      {},
      {
        auth: {
          uid: 'u-sync',
          token: {
            email: 'admin@example.com',
          },
        },
      }
    );

    expect(resolveRoleForEmail).toHaveBeenCalledWith('admin@example.com');
    expect(getUser).toHaveBeenCalledWith('u-sync');
    expect(setCustomUserClaims).toHaveBeenCalledWith('u-sync', {
      featureFlag: true,
      role: 'admin',
    });
    expect(result).toEqual({
      role: 'admin',
      synced: true,
    });
  });
});
