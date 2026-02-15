import { describe, expect, it } from 'vitest';
import {
    resolveMovementSummaryState,
    resolveStaffSelectorsClassName,
    resolveStaffSelectorsState
} from '@/features/census/controllers/censusStaffHeaderController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('censusStaffHeaderController', () => {
    it('normalizes nullable staff arrays to safe arrays', () => {
        expect(resolveStaffSelectorsState(null)).toEqual({
            nursesDayShift: [],
            nursesNightShift: [],
            tensDayShift: [],
            tensNightShift: []
        });

        expect(resolveStaffSelectorsState({
            nursesDayShift: ['A'],
            nursesNightShift: undefined,
            tensDayShift: ['T1', 'T2'],
            tensNightShift: null
        })).toEqual({
            nursesDayShift: ['A'],
            nursesNightShift: [],
            tensDayShift: ['T1', 'T2'],
            tensNightShift: []
        });
    });

    it('normalizes movement data and computes cmaCount', () => {
        const result = resolveMovementSummaryState({
            discharges: [DataFactory.createMockDischarge({ id: 'd1' })],
            transfers: [DataFactory.createMockTransfer({ id: 't1' })],
            cma: [DataFactory.createMockCMA({ id: 'c1' }), DataFactory.createMockCMA({ id: 'c2' })]
        });

        expect(result.discharges).toHaveLength(1);
        expect(result.transfers).toHaveLength(1);
        expect(result.cmaCount).toBe(2);
        expect(resolveMovementSummaryState(undefined)).toEqual({
            discharges: [],
            transfers: [],
            cmaCount: 0
        });
    });

    it('returns read-only class name only when readOnly is true', () => {
        expect(resolveStaffSelectorsClassName(true)).toBe('pointer-events-none opacity-80');
        expect(resolveStaffSelectorsClassName(false)).toBe('');
    });
});
