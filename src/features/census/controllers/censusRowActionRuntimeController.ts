import type { PatientData, CMAData } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type {
    ActionState,
    DischargeState,
    TransferState
} from '@/features/census/types/censusActionTypes';
import type { PatientRowAction } from '@/features/census/components/patient-row/patientActionMenuConfig';
import {
    type RowActionError,
    type RowActionErrorCode,
    type RowActionConfirmDescriptor,
    resolveRowActionCommand
} from '@/features/census/controllers/censusRowActionController';
import { type ControllerResult, ok } from '@/features/census/controllers/controllerResult';

export interface RowActionRuntimeActions {
    clearPatient: (bedId: string) => void;
    addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
    setMovement: (nextActionState: ActionState) => void;
    openDischarge: (dischargePatch: Partial<DischargeState>) => void;
    openTransfer: (transferPatch: Partial<TransferState>) => void;
}

export interface RowActionRuntimeConfirm {
    confirm: (descriptor: RowActionConfirmDescriptor) => Promise<boolean>;
}

export interface RowActionRuntimeSuccess {
    applied: boolean;
}

export type RowActionRuntimeResult = ControllerResult<
    RowActionRuntimeSuccess,
    RowActionErrorCode,
    RowActionError
>;

interface ExecuteRowActionParams {
    action: PatientRowAction;
    bedId: string;
    patient: PatientData;
    stabilityRules: StabilityRules;
    actions: RowActionRuntimeActions;
    confirmRuntime: RowActionRuntimeConfirm;
}

export const executeRowActionController = async ({
    action,
    bedId,
    patient,
    stabilityRules,
    actions,
    confirmRuntime
}: ExecuteRowActionParams): Promise<RowActionRuntimeResult> => {
    const resolution = resolveRowActionCommand({ action, bedId, patient, stabilityRules });
    if (!resolution.ok) {
        return resolution;
    }

    const command = resolution.value;
    switch (command.kind) {
        case 'confirmClear': {
            const isConfirmed = await confirmRuntime.confirm(command.confirm);
            if (!isConfirmed) {
                return ok({ applied: false });
            }
            actions.clearPatient(command.bedId);
            return ok({ applied: true });
        }
        case 'setMovement':
            actions.setMovement(command.nextActionState);
            return ok({ applied: true });
        case 'openDischarge':
            actions.openDischarge(command.dischargePatch);
            return ok({ applied: true });
        case 'openTransfer':
            actions.openTransfer(command.transferPatch);
            return ok({ applied: true });
        case 'confirmCma': {
            const isConfirmed = await confirmRuntime.confirm(command.confirm);
            if (!isConfirmed) {
                return ok({ applied: false });
            }
            actions.addCMA(command.cmaData);
            actions.clearPatient(command.bedId);
            return ok({ applied: true });
        }
    }
};
