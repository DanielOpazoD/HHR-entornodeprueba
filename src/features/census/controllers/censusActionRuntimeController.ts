import type { DailyRecord } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type {
    ActionState,
    DischargeState,
    DischargeTarget,
    TransferState
} from '@/features/census/types/censusActionTypes';
import { createInitialActionState } from '@/features/census/types/censusActionTypes';
import {
    type CensusActionError,
    type CensusActionErrorCode,
    type DischargeExecutionInput,
    type TransferExecutionInput,
    resolveDischargeCommand,
    resolveMoveOrCopyCommand,
    resolveTransferCommand
} from '@/features/census/controllers/censusActionExecutionController';
import {
    type ControllerError,
    type ControllerResult,
    failWithCode,
    ok
} from '@/features/census/controllers/controllerResult';

export interface MoveOrCopyRuntimeActions {
    moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;
    copyPatientToDate: (bedId: string, targetDate: string, targetBedId?: string) => Promise<void>;
}

export interface DischargeRuntimeActions {
    addDischarge: (
        bedId: string,
        status: 'Vivo' | 'Fallecido',
        cribStatus?: 'Vivo' | 'Fallecido',
        dischargeType?: string,
        dischargeTypeOther?: string,
        time?: string,
        target?: DischargeTarget
    ) => void;
    updateDischarge: (
        id: string,
        status: 'Vivo' | 'Fallecido',
        dischargeType?: string,
        dischargeTypeOther?: string,
        time?: string
    ) => void;
}

export interface TransferRuntimeActions {
    addTransfer: (
        bedId: string,
        method: string,
        center: string,
        centerOther: string,
        escort?: string,
        time?: string
    ) => void;
    updateTransfer: (id: string, updates: {
        evacuationMethod: TransferState['evacuationMethod'];
        receivingCenter: TransferState['receivingCenter'];
        receivingCenterOther: string;
        transferEscort: string;
        time: string;
    }) => void;
}

export type MoveOrCopyRuntimeErrorCode = CensusActionErrorCode | 'COPY_TO_DATE_FAILED';
export type MoveOrCopyRuntimeError =
    | CensusActionError
    | ControllerError<'COPY_TO_DATE_FAILED'>;

export interface MoveOrCopyRuntimeSuccess {
    nextActionState: ActionState;
}

export interface ModalCloseSuccess {
    closeModalPatch: { isOpen: false };
}

export type MoveOrCopyRuntimeResult = ControllerResult<
    MoveOrCopyRuntimeSuccess,
    MoveOrCopyRuntimeErrorCode,
    MoveOrCopyRuntimeError
>;
export type DischargeRuntimeResult = ControllerResult<
    ModalCloseSuccess,
    CensusActionErrorCode,
    CensusActionError
>;
export type TransferRuntimeResult = ControllerResult<
    ModalCloseSuccess,
    CensusActionErrorCode,
    CensusActionError
>;

interface ExecuteMoveOrCopyParams {
    actionState: ActionState;
    record: DailyRecord | null;
    targetDate?: string;
    actions: MoveOrCopyRuntimeActions;
}

interface ExecuteDischargeParams {
    dischargeState: DischargeState;
    data?: DischargeExecutionInput;
    stabilityRules: StabilityRules;
    nowTime: string;
    actions: DischargeRuntimeActions;
}

interface ExecuteTransferParams {
    transferState: TransferState;
    data?: TransferExecutionInput;
    stabilityRules: StabilityRules;
    nowTime: string;
    actions: TransferRuntimeActions;
}

export const executeMoveOrCopyController = async ({
    actionState,
    record,
    targetDate,
    actions
}: ExecuteMoveOrCopyParams): Promise<MoveOrCopyRuntimeResult> => {
    const resolution = resolveMoveOrCopyCommand({ actionState, record, targetDate });
    if (!resolution.ok) {
        return resolution;
    }

    const command = resolution.value;
    if (command.kind === 'copyToDate') {
        try {
            await actions.copyPatientToDate(
                command.sourceBedId,
                command.targetDate,
                command.targetBedId
            );
        } catch {
            return failWithCode(
                'COPY_TO_DATE_FAILED',
                'No se pudo copiar el paciente a la fecha seleccionada.'
            );
        }
    } else {
        actions.moveOrCopyPatient(
            command.movementType,
            command.sourceBedId,
            command.targetBedId
        );
    }

    return ok({
        nextActionState: createInitialActionState()
    });
};

export const executeDischargeController = ({
    dischargeState,
    data,
    stabilityRules,
    nowTime,
    actions
}: ExecuteDischargeParams): DischargeRuntimeResult => {
    const resolution = resolveDischargeCommand({
        dischargeState,
        data,
        stabilityRules,
        nowTime
    });
    if (!resolution.ok) {
        return resolution;
    }

    const command = resolution.value;
    if (command.kind === 'updateDischarge') {
        actions.updateDischarge(
            command.id,
            command.payload.status,
            command.payload.type,
            command.payload.typeOther,
            command.payload.time
        );
    } else {
        actions.addDischarge(
            command.bedId,
            command.payload.status,
            command.payload.cribStatus,
            command.payload.type,
            command.payload.typeOther,
            command.payload.time,
            command.payload.dischargeTarget
        );
    }

    return ok({
        closeModalPatch: { isOpen: false }
    });
};

export const executeTransferController = ({
    transferState,
    data,
    stabilityRules,
    nowTime,
    actions
}: ExecuteTransferParams): TransferRuntimeResult => {
    const resolution = resolveTransferCommand({
        transferState,
        data,
        stabilityRules,
        nowTime
    });
    if (!resolution.ok) {
        return resolution;
    }

    const command = resolution.value;
    if (command.kind === 'updateTransfer') {
        actions.updateTransfer(command.id, {
            evacuationMethod: command.payload.evacuationMethod,
            receivingCenter: command.payload.receivingCenter,
            receivingCenterOther: command.payload.receivingCenterOther,
            transferEscort: command.payload.transferEscort,
            time: command.payload.time
        });
    } else {
        actions.addTransfer(
            command.bedId,
            command.payload.evacuationMethod,
            command.payload.receivingCenter,
            command.payload.receivingCenterOther,
            command.payload.transferEscort,
            command.payload.time
        );
    }

    return ok({
        closeModalPatch: { isOpen: false }
    });
};
