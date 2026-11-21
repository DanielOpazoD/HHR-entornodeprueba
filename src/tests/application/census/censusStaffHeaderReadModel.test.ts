import { describe, expect, it } from 'vitest';
import { buildCensusStaffHeaderReadModel } from '@/features/census/controllers/censusStaffHeaderReadModel';

describe('buildCensusStaffHeaderReadModel', () => {
  it('deriva staff, movimientos y visibilidad del summary desde un solo punto', () => {
    const model = buildCensusStaffHeaderReadModel({
      readOnly: true,
      stats: {
        occupiedBeds: 10,
        serviceCapacity: 18,
        blockedBeds: 1,
        availableCapacity: 7,
        clinicalCribsCount: 1,
        companionCribs: 1,
        totalCribsUsed: 2,
      } as never,
      accessProfile: 'default',
      beds: {},
      recordDate: '2026-03-15',
      staffData: {
        nursesDayShift: ['A'],
        nursesNightShift: ['B'],
        tensDayShift: ['C'],
        tensNightShift: ['D'],
      },
      movementsData: {
        discharges: [],
        transfers: [],
        cma: [{ id: 'c1' }],
      },
    });

    expect(model.selectorsClassName).toContain('pointer-events-none');
    expect(model.staffSelectorsState.nursesDayShift).toEqual(['A']);
    expect(model.staffIndicatorsState.nurseIndicators.day).toEqual({
      extraCount: 0,
      hasSpecialSchedule: false,
    });
    expect(model.movementSummaryState.cmaCount).toBe(1);
    expect(model.showSummary).toBe(true);
  });
});
