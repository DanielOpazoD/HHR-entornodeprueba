import { describe, expect, it } from 'vitest';
import type { CMAData, DischargeData, TransferData } from '@/types';
import {
  filterCmaByShift,
  filterDischargesByShift,
  filterTransfersByShift,
  isMovementInSelectedShift,
} from '@/features/handoff/controllers/movementsSummaryController';

describe('movementsSummaryController', () => {
  it('classifies movement times by selected shift', () => {
    expect(isMovementInSelectedShift({ time: '10:00' }, 'day')).toBe(true);
    expect(isMovementInSelectedShift({ time: '10:00' }, 'night')).toBe(false);
    expect(isMovementInSelectedShift({ time: '02:00' }, 'day')).toBe(false);
    expect(isMovementInSelectedShift({ time: '02:00' }, 'night')).toBe(true);
  });

  it('keeps legacy time-less movements in day shift only', () => {
    expect(isMovementInSelectedShift({ time: '' }, 'day')).toBe(true);
    expect(isMovementInSelectedShift({ time: '' }, 'night')).toBe(false);
    expect(isMovementInSelectedShift({}, 'day')).toBe(true);
    expect(isMovementInSelectedShift({}, 'night')).toBe(false);
  });

  it('filters discharges by shift preserving night records', () => {
    const discharges = [
      { id: 'd1', time: '10:00' },
      { id: 'd2', time: '22:00' },
      { id: 'd3', time: '' },
    ] as unknown as DischargeData[];

    expect(filterDischargesByShift(discharges, 'day').map(d => d.id)).toEqual(['d1', 'd3']);
    expect(filterDischargesByShift(discharges, 'night').map(d => d.id)).toEqual(['d2']);
  });

  it('filters transfers by shift preserving night records', () => {
    const transfers = [
      { id: 't1', time: '14:00' },
      { id: 't2', time: '02:00' },
    ] as unknown as TransferData[];

    expect(filterTransfersByShift(transfers, 'day').map(t => t.id)).toEqual(['t1']);
    expect(filterTransfersByShift(transfers, 'night').map(t => t.id)).toEqual(['t2']);
  });

  it('returns CMA entries only for day shift', () => {
    const cma = [{ id: 'c1' }, { id: 'c2' }] as unknown as CMAData[];

    expect(filterCmaByShift(cma, 'day')).toHaveLength(2);
    expect(filterCmaByShift(cma, 'night')).toHaveLength(0);
  });
});
