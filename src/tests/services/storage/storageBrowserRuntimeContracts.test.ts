import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractE2EForcedMovementAuthorityPatch,
  isE2EForcedMovementAuthorityPatch,
} from '@/services/storage/firestore/firestoreRecordWrites';
import {
  buildSyncMutationIdentity,
  resetSyncMutationIdentityForTests,
} from '@/services/storage/sync/syncMutationIdentity';

describe('firestore E2E authority routing', () => {
  beforeEach(() => localStorage.clear());

  it('routes only movement patches when the authority callable is forced', () => {
    const movementPatch = {
      discharges: [{ id: 'd-1', clinicalEpisodeId: '910001' }],
      transfers: [],
      cma: [],
      dateTimestamp: 1773360000000,
    };

    expect(isE2EForcedMovementAuthorityPatch(movementPatch)).toBe(false);

    localStorage.setItem('hhr_e2e_force_authority_callable', 'true');
    expect(isE2EForcedMovementAuthorityPatch(movementPatch)).toBe(true);
    expect(isE2EForcedMovementAuthorityPatch({ ...movementPatch, handoff: 'mixed' })).toBe(false);
    expect(extractE2EForcedMovementAuthorityPatch(movementPatch)).toEqual({
      discharges: movementPatch.discharges,
      transfers: [],
      cma: [],
    });
  });
});

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
