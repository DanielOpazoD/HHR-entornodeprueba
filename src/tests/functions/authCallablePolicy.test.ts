import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
const {
  assertAssignableRole,
  assertRoleMutationAccess,
  parseRoleMutationRequest,
} = require('../../../functions/lib/auth/authCallablePolicy.js');

describe('functions authCallablePolicy', () => {
  it('parses raw role mutation input defensively', () => {
    expect(parseRoleMutationRequest({ email: 'user@example.com', role: 'admin' })).toEqual({
      rawEmail: 'user@example.com',
      rawRole: 'admin',
    });
    expect(parseRoleMutationRequest({})).toEqual({
      rawEmail: '',
      rawRole: '',
    });
  });

  it('allows role mutation for current configured admins and rejects invalid roles', async () => {
    const resolveRoleForEmail = vi.fn().mockResolvedValue('admin');
    await expect(
      assertRoleMutationAccess({
        context: { auth: { token: { email: ' Admin@example.invalid ', role: 'viewer' } } },
        resolveRoleForEmail,
      })
    ).resolves.toBeUndefined();
    expect(resolveRoleForEmail).toHaveBeenCalledWith(
      'admin@example.invalid',
      expect.objectContaining({
        auth: expect.objectContaining({
          token: expect.objectContaining({ email: ' Admin@example.invalid ' }),
        }),
      })
    );

    expect(() => assertAssignableRole('user@example.com', 'not-a-role')).toThrow(/Invalid role/);
  });

  it.each(['viewer', 'unauthorized'])(
    'rejects a stale admin claim when configured role is %s',
    async role => {
      await expect(
        assertRoleMutationAccess({
          context: { auth: { token: { email: 'revoked@example.invalid', role: 'admin' } } },
          resolveRoleForEmail: vi.fn().mockResolvedValue(role),
        })
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
  );

  it.each([null, { token: { role: 'admin' } }])(
    'rejects callers without an authenticated email',
    async auth => {
      const resolveRoleForEmail = vi.fn();
      await expect(
        assertRoleMutationAccess({ context: { auth }, resolveRoleForEmail })
      ).rejects.toMatchObject({ code: 'permission-denied' });
      expect(resolveRoleForEmail).not.toHaveBeenCalled();
    }
  );
});
