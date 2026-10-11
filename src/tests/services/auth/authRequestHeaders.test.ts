// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();

vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: Promise.resolve(),
    getCurrentUser: () => getCurrentUserMock(),
  },
}));

import {
  resolveCurrentUserAuthHeaders,
  resolveCurrentUserBearerToken,
} from '@/services/auth/authRequestHeaders';

describe('authRequestHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when there is no authenticated user', async () => {
    getCurrentUserMock.mockReturnValue(null);

    await expect(resolveCurrentUserBearerToken()).resolves.toBeNull();
    await expect(resolveCurrentUserAuthHeaders()).resolves.toEqual({});
  });

  it('returns null for anonymous users', async () => {
    getCurrentUserMock.mockReturnValue({
      isAnonymous: true,
    });

    await expect(resolveCurrentUserBearerToken()).resolves.toBeNull();
  });

  it('builds bearer headers for authenticated users', async () => {
    const getIdToken = vi.fn().mockResolvedValue('firebase-token-123');
    getCurrentUserMock.mockReturnValue({
      isAnonymous: false,
      getIdToken,
    });

    await expect(resolveCurrentUserBearerToken()).resolves.toBe('firebase-token-123');
    await expect(resolveCurrentUserAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer firebase-token-123',
    });
    expect(getIdToken).toHaveBeenCalledTimes(2);
  });

  it('supports an injected auth runtime seam', async () => {
    const getIdToken = vi.fn().mockResolvedValue('injected-token');

    await expect(
      resolveCurrentUserBearerToken({
        authRuntime: {
          ready: Promise.resolve(),
          auth: {} as never,
          getCurrentUser: () =>
            ({
              isAnonymous: false,
              getIdToken,
            }) as never,
        },
      })
    ).resolves.toBe('injected-token');
  });
});
