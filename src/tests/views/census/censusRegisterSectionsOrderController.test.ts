import { describe, expect, it } from 'vitest';

import { resolveCensusRegisterMovementSectionOrder } from '@/features/census/controllers/censusRegisterSectionsOrderController';

describe('censusRegisterSectionsOrderController', () => {
  it('moves empty movement sections after sections with data while preserving relative order', () => {
    expect(
      resolveCensusRegisterMovementSectionOrder({
        dischargesCount: 1,
        transfersCount: 0,
        cmaCount: 2,
      })
    ).toEqual(['discharges', 'cma', 'transfers']);
  });

  it('applies the same empty-section rule to any section', () => {
    expect(
      resolveCensusRegisterMovementSectionOrder({
        dischargesCount: 0,
        transfersCount: 1,
        cmaCount: 1,
      })
    ).toEqual(['transfers', 'cma', 'discharges']);
  });

  it('keeps the default order when every movement section is empty', () => {
    expect(
      resolveCensusRegisterMovementSectionOrder({
        dischargesCount: 0,
        transfersCount: 0,
        cmaCount: 0,
      })
    ).toEqual(['discharges', 'transfers', 'cma']);
  });
});
