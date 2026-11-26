// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callableMock = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => callableMock),
}));

import {
  createAuthClaimSyncService,
  getAuthClaimSyncSnapshot,
  resetAuthClaimSyncSnapshot,
} from '@/services/auth/authClaimSyncService';

describe('authClaimSyncService runtime injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthClaimSyncSnapshot();
    callableMock.mockResolvedValue({
      data: {
        role: 'admin',
      },
    });
  });

  it('syncs role claims through an injected functions runtime', async () => {
    const service = createAuthClaimSyncService({
      getFunctions: vi.fn().mockResolvedValue({ custom: true } as never),
    });

    await expect(service.syncCurrentUserRoleClaim()).resolves.toEqual({
      role: 'admin',
    });
  });

  it('resets the shared claim sync snapshot helper', () => {
    expect(getAuthClaimSyncSnapshot().status).toBe('idle');
  });
});
