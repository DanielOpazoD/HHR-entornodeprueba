import { describe, expect, it } from 'vitest';
import {
    DEFAULT_EVACUATION_METHOD,
    DEFAULT_RECEIVING_CENTER,
    DEFAULT_TRANSFER_ESCORT,
    EVACUATION_METHOD_AEROCARDAL
} from '@/constants';
import { applyTransferStateUpdate } from '@/features/census/controllers/censusTransferStateController';
import type { TransferState } from '@/features/census/types/censusActionTypes';

const baseState: TransferState = {
    bedId: 'R1',
    isOpen: true,
    evacuationMethod: DEFAULT_EVACUATION_METHOD,
    evacuationMethodOther: '',
    receivingCenter: DEFAULT_RECEIVING_CENTER,
    receivingCenterOther: '',
    transferEscort: DEFAULT_TRANSFER_ESCORT
};

describe('censusTransferStateController', () => {
    it('normalizes evacuation method and clears escort for Aerocardal', () => {
        const result = applyTransferStateUpdate(
            baseState,
            'evacuationMethod',
            EVACUATION_METHOD_AEROCARDAL
        );

        expect(result.evacuationMethod).toBe(EVACUATION_METHOD_AEROCARDAL);
        expect(result.transferEscort).toBe('');
    });

    it('normalizes unknown evacuation method to default', () => {
        const result = applyTransferStateUpdate(baseState, 'evacuationMethod', 'INVALID');
        expect(result.evacuationMethod).toBe(DEFAULT_EVACUATION_METHOD);
    });

    it('normalizes unknown receiving center to default', () => {
        const result = applyTransferStateUpdate(baseState, 'receivingCenter', 'INVALID');
        expect(result.receivingCenter).toBe(DEFAULT_RECEIVING_CENTER);
    });

    it('updates free-text fields and escort directly', () => {
        const withEvacuationOther = applyTransferStateUpdate(
            baseState,
            'evacuationMethodOther',
            'Helicóptero privado'
        );
        const withCenterOther = applyTransferStateUpdate(
            withEvacuationOther,
            'receivingCenterOther',
            'Centro X'
        );
        const withEscort = applyTransferStateUpdate(withCenterOther, 'transferEscort', 'Matrona');

        expect(withEscort.evacuationMethodOther).toBe('Helicóptero privado');
        expect(withEscort.receivingCenterOther).toBe('Centro X');
        expect(withEscort.transferEscort).toBe('Matrona');
    });
});
