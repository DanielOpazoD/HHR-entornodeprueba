import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../../../functions/lib/auth/authHelpersFactory.js');

const createFirebaseServicesStub = (options: {
  dynamicRoles?: Record<string, string>;
  rolesReadError?: Error;
}) => {
  const dynamicRoles = options.dynamicRoles ?? null;

  return {
    firestore: {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            if (name === 'config' && id === 'roles') {
              if (options.rolesReadError) throw options.rolesReadError;
              return {
                exists: !!dynamicRoles,
                data: () => dynamicRoles ?? {},
              };
            }
            return { exists: false, data: () => ({}) };
          },
        }),
      }),
    },
    auth: {
      setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    },
  };
};

describe('functions authHelpersFactory', () => {
  it('resolves dynamic roles from config/roles without mutating the source document', async () => {
    const services = createFirebaseServicesStub({
      dynamicRoles: { 'custom@example.com': 'viewer_census' },
    });
    const helpers = createAuthHelpers(services);

    await expect(helpers.resolveRoleForEmail('custom@example.com')).resolves.toBe('viewer');
  });

  it('treats doctor_specialist as valid general login access in callable helpers', async () => {
    const services = createFirebaseServicesStub({
      dynamicRoles: { 'specialist@example.com': 'doctor_specialist' },
    });
    const helpers = createAuthHelpers(services);

    await expect(
      helpers.hasCallableClinicalAccess({
        auth: {
          token: {
            email: 'specialist@example.com',
          },
        },
      })
    ).resolves.toBe(true);
  });

  it('normalizes viewer_census to viewer for callable helpers', async () => {
    const services = createFirebaseServicesStub({
      dynamicRoles: { 'shared@example.com': 'viewer_census' },
    });
    const helpers = createAuthHelpers(services);

    await expect(
      helpers.hasCallableClinicalAccess({
        auth: {
          token: {
            email: 'shared@example.com',
          },
        },
      })
    ).resolves.toBe(true);
  });

  describe('when config/roles cannot be read', () => {
    const rolesReadError = new Error('Synthetic roles read unavailable');
    const callerToken = { auth: { token: { email: 'doctor@example.com' } } };

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reports the failed read instead of a denial', async () => {
      const helpers = createAuthHelpers(createFirebaseServicesStub({ rolesReadError }));

      await expect(helpers.resolveRoleForEmail('doctor@example.com')).rejects.toBe(rolesReadError);
      await expect(helpers.hasCallableClinicalAccess(callerToken)).rejects.toBe(rolesReadError);
    });

    it('stamps no role on a new account', async () => {
      const services = createFirebaseServicesStub({ rolesReadError });
      const helpers = createAuthHelpers(services);

      await expect(
        helpers.assignRole({ uid: 'new-user', email: 'doctor@example.com' })
      ).rejects.toBe(rolesReadError);
      expect(services.auth.setCustomUserClaims).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['the roles document does not exist', undefined],
    ['the roles document does not list the email', { 'other@example.com': 'admin' }],
    ['the listed role is blank', { 'doctor@example.com': '  ' }],
  ])('denies when %s', async (_case, dynamicRoles) => {
    const services = createFirebaseServicesStub({ dynamicRoles });
    const helpers = createAuthHelpers(services);

    await expect(helpers.resolveRoleForEmail('doctor@example.com')).resolves.toBe('unauthorized');
    await expect(
      helpers.hasCallableClinicalAccess({ auth: { token: { email: 'doctor@example.com' } } })
    ).resolves.toBe(false);
  });
});
