import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
import type {
    ActionState,
    DischargeState,
    TransferState
} from '@/features/census/types/censusActionTypes';
import type { TransferStateFieldUpdate } from '@/features/census/controllers/censusTransferStateController';
import type { DischargeStatus } from '@/constants';

interface UseCensusModalsHandlersParams {
    setActionState: Dispatch<SetStateAction<ActionState>>;
    setDischargeState: Dispatch<SetStateAction<DischargeState>>;
    setTransferState: Dispatch<SetStateAction<TransferState>>;
}

export const useCensusModalsHandlers = ({
    setActionState,
    setDischargeState,
    setTransferState
}: UseCensusModalsHandlersParams) => {
    const closeMoveCopy = useCallback(() => {
        setActionState(closeMoveCopyModalState());
    }, [setActionState]);

    const setMoveCopyTarget = useCallback((targetBedId: string) => {
        setActionState(previousState => patchMoveCopyTargetBed(previousState, targetBedId));
    }, [setActionState]);

    const updateDischargeStatus = useCallback((status: DischargeStatus) => {
        setDischargeState(previousState => patchDischargeStatus(previousState, status));
    }, [setDischargeState]);

    const updateDischargeClinicalCribStatus = useCallback((status: DischargeStatus) => {
        setDischargeState(previousState => patchDischargeClinicalCribStatus(previousState, status));
    }, [setDischargeState]);

    const updateDischargeTarget = useCallback((target: DischargeState['dischargeTarget']) => {
        if (!target) {
            return;
        }

        setDischargeState(previousState => patchDischargeTarget(previousState, target));
    }, [setDischargeState]);

    const closeDischarge = useCallback(() => {
        setDischargeState(previousState => closeDischargeModalState(previousState));
    }, [setDischargeState]);

    const updateTransfer = useCallback((field: TransferStateFieldUpdate, value: string) => {
        setTransferState(previousState => patchTransferField(previousState, field, value));
    }, [setTransferState]);

    const closeTransfer = useCallback(() => {
        setTransferState(previousState => closeTransferModalState(previousState));
    }, [setTransferState]);

    return {
        closeMoveCopy,
        setMoveCopyTarget,
        updateDischargeStatus,
        updateDischargeClinicalCribStatus,
        updateDischargeTarget,
        closeDischarge,
        updateTransfer,
        closeTransfer
    };
};
