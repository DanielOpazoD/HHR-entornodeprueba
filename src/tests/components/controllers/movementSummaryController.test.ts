import { describe, expect, it } from 'vitest';

import { buildMovementSummaryModel } from '@/components/layout/controllers/movementSummaryController';
import type { DischargeData, TransferData } from '@/types/domain/movements';

describe('movementSummaryController', () => {
  it('aggregates movement counts for UI consumption', () => {
    const discharges = [
      { status: 'Alta' },
      { status: 'Fallecido' },
      { status: 'Vivo', isNested: true },
    ] as DischargeData[];
    const transfers = [{ id: 't1' }, { id: 't2' }] as TransferData[];

    expect(buildMovementSummaryModel(discharges, transfers, 3, 4)).toEqual({
      totalDeaths: 1,
      totalDischarges: 2,
      totalTransfers: 2,
      cmaCount: 3,
      newAdmissions: 4,
    });
  });
});
