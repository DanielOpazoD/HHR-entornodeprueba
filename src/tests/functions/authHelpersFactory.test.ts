import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../../../functions/lib/auth/authHelpersFactory.js');

const createFirebaseServicesStub = (options: { dynamicRoles?: Record<string, string> }) => {
  const dynamicRoles = options.dynamicRoles ?? null;

  return {
    firestore: {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            if (name === 'config' && id === 'roles') {
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
});
