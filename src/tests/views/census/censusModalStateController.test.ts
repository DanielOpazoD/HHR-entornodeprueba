import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCHARGE_STATUS, DEFAULT_EVACUATION_METHOD, DEFAULT_RECEIVING_CENTER, DEFAULT_TRANSFER_ESCORT } from '@/constants';
import type { ActionState, DischargeState, TransferState } from '@/features/census/types/censusActionTypes';
import {
    closeDischargeModalState,
    closeMoveCopyModalState,
    closeTransferModalState,
    patchDischargeClinicalCribStatus,
    patchDischargeStatus,
    patchDischargeTarget,
    patchMoveCopyTargetBed,
    patchTransferField
} from '@/features/census/controllers/censusModalStateController';

describe('censusModalStateController', () => {
    it('resets move/copy modal state and updates target bed', () => {
        const state: ActionState = { type: 'move', sourceBedId: 'R1', targetBedId: null };

        expect(patchMoveCopyTargetBed(state, 'R2')).toEqual({
            type: 'move',
            sourceBedId: 'R1',
            targetBedId: 'R2'
        });

        expect(closeMoveCopyModalState()).toEqual({
            type: null,
            sourceBedId: null,
            targetBedId: null
        });
    });

    it('patches discharge state fields and closes modal', () => {
        const state: DischargeState = {
            bedId: 'R1',
            isOpen: true,
            status: DEFAULT_DISCHARGE_STATUS
        };

        const withStatus = patchDischargeStatus(state, 'Fallecido');
        const withCrib = patchDischargeClinicalCribStatus(withStatus, 'Vivo');
        const withTarget = patchDischargeTarget(withCrib, 'mother');
        const closed = closeDischargeModalState(withTarget);

        expect(closed).toEqual({
            bedId: 'R1',
            isOpen: false,
            status: 'Fallecido',
            clinicalCribStatus: 'Vivo',
            dischargeTarget: 'mother'
        });
    });

    it('patches transfer fields and closes modal', () => {
        const state: TransferState = {
            bedId: 'R1',
            isOpen: true,
            evacuationMethod: DEFAULT_EVACUATION_METHOD,
            evacuationMethodOther: '',
            receivingCenter: DEFAULT_RECEIVING_CENTER,
            receivingCenterOther: '',
            transferEscort: DEFAULT_TRANSFER_ESCORT
        };

        const withEscort = patchTransferField(state, 'transferEscort', 'Matrona');
        const closed = closeTransferModalState(withEscort);

        expect(closed.isOpen).toBe(false);
        expect(closed.transferEscort).toBe('Matrona');
    });
});
