import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractE2EForcedMovementAuthorityPatch,
  isE2EForcedMovementAuthorityPatch,
} from '@/services/storage/firestore/firestoreE2EAuthorityRouting';

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
