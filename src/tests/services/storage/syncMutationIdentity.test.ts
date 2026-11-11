import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSyncMutationIdentity,
  resetSyncMutationIdentityForTests,
} from '@/services/storage/sync/syncMutationIdentity';

describe('syncMutationIdentity optional storage', () => {
  beforeEach(() => resetSyncMutationIdentityForTests());
  afterEach(() => vi.restoreAllMocks());

  it.each(['localStorage', 'sessionStorage'] as const)(
    'keeps stable runtime identity and unique mutations when %s access throws',
    capability => {
      vi.spyOn(globalThis, capability, 'get').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
      const first = buildSyncMutationIdentity();
      const second = buildSyncMutationIdentity();
      expect(first.clientId).toMatch(/^client_/);
      expect(first.tabId).toMatch(/^tab_/);
      expect(second.clientId).toBe(first.clientId);
      expect(second.tabId).toBe(first.tabId);
      expect(second.mutationId).not.toBe(first.mutationId);
    }
  );
});
