import type {
    ActionState,
    DischargeState,
    DischargeTarget,
    TransferState
} from '@/features/census/types/censusActionTypes';
import { createInitialActionState } from '@/features/census/types/censusActionTypes';
import type { DischargeStatus } from '@/constants';
import { applyTransferStateUpdate, type TransferStateFieldUpdate } from '@/features/census/controllers/censusTransferStateController';

export const closeMoveCopyModalState = (): ActionState => createInitialActionState();

export const patchMoveCopyTargetBed = (
    previousState: ActionState,
    targetBedId: string
): ActionState => ({
    ...previousState,
    targetBedId
});

export const closeDischargeModalState = (previousState: DischargeState): DischargeState => ({
    ...previousState,
    isOpen: false
});

export const patchDischargeStatus = (
    previousState: DischargeState,
    status: DischargeStatus
): DischargeState => ({
    ...previousState,
    status
});

export const patchDischargeClinicalCribStatus = (
    previousState: DischargeState,
    clinicalCribStatus: DischargeStatus
): DischargeState => ({
    ...previousState,
    clinicalCribStatus
});

export const patchDischargeTarget = (
    previousState: DischargeState,
    dischargeTarget: DischargeTarget
): DischargeState => ({
    ...previousState,
    dischargeTarget
});

export const closeTransferModalState = (previousState: TransferState): TransferState => ({
    ...previousState,
    isOpen: false
});

export const patchTransferField = (
    previousState: TransferState,
    field: TransferStateFieldUpdate,
    value: string
): TransferState => applyTransferStateUpdate(previousState, field, value);
