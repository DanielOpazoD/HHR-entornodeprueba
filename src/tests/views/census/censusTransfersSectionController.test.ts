import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
    executeTransferTimeChangeController,
    resolveTransfersSectionState
} from '@/features/census/controllers/censusTransfersSectionController';

describe('censusTransfersSectionController', () => {
    it('resolves null transfers as non-renderable state', () => {
        expect(resolveTransfersSectionState(null)).toEqual({
            isRenderable: false,
            isEmpty: true,
            transfers: []
        });
    });

    it('resolves undefined transfers as renderable empty state', () => {
        expect(resolveTransfersSectionState(undefined)).toEqual({
            isRenderable: true,
            isEmpty: true,
            transfers: []
        });
    });

    it('updates transfer time when id exists', () => {
        const transfers = [
            DataFactory.createMockTransfer({
                id: 't1',
                time: '10:00',
                evacuationMethod: 'Ambulancia',
                receivingCenter: 'Hospital A',
                receivingCenterOther: '',
                transferEscort: 'Nurse A'
            })
        ];
        const updateTransfer = vi.fn();

        const updated = executeTransferTimeChangeController(
            transfers,
            't1',
            '13:45',
            updateTransfer
        );

        expect(updated).toBe(true);
        expect(updateTransfer).toHaveBeenCalledWith('t1', expect.objectContaining({
            time: '13:45'
        }));
    });

    it('does not update when id does not exist', () => {
        const updated = executeTransferTimeChangeController(
            [DataFactory.createMockTransfer({ id: 't1' })],
            'missing',
            '13:45',
            vi.fn()
        );

        expect(updated).toBe(false);
    });
});
