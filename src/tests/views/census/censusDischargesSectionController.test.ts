import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
    executeDischargeTimeChangeController,
    resolveDischargesSectionState
} from '@/features/census/controllers/censusDischargesSectionController';

describe('censusDischargesSectionController', () => {
    it('resolves null discharges as non-renderable state', () => {
        expect(resolveDischargesSectionState(null)).toEqual({
            isRenderable: false,
            isEmpty: true,
            discharges: []
        });
    });

    it('resolves undefined discharges as renderable empty state', () => {
        expect(resolveDischargesSectionState(undefined)).toEqual({
            isRenderable: true,
            isEmpty: true,
            discharges: []
        });
    });

    it('updates discharge time when id exists', () => {
        const discharges = [
            DataFactory.createMockDischarge({
                id: 'd1',
                time: '10:00',
                status: 'Vivo',
                dischargeType: 'Domicilio (Habitual)'
            })
        ];
        const updateDischarge = vi.fn();

        const updated = executeDischargeTimeChangeController(
            discharges,
            'd1',
            '14:30',
            updateDischarge
        );

        expect(updated).toBe(true);
        expect(updateDischarge).toHaveBeenCalledWith(
            'd1',
            'Vivo',
            'Domicilio (Habitual)',
            undefined,
            '14:30'
        );
    });

    it('does not update when id does not exist', () => {
        const updated = executeDischargeTimeChangeController(
            [DataFactory.createMockDischarge({ id: 'd1' })],
            'missing',
            '14:30',
            vi.fn()
        );

        expect(updated).toBe(false);
    });
});
