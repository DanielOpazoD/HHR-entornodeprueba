import {
    type PatientRowBedConfigError,
    type PatientRowBedConfigErrorCode,
    resolveToggleBedModeCommand,
    resolveToggleClinicalCribCommand,
    resolveToggleCompanionCribCommand
} from '@/features/census/controllers/patientRowBedConfigController';
import {
    type ControllerResult,
    fail,
    failWithCode,
    ok
} from '@/features/census/controllers/controllerResult';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';

type BedModeFieldValue = 'Cama' | 'Cuna' | boolean;

interface BedConfigRuntimeActions {
    updatePatient: (
        bedId: string,
        field: 'bedMode' | 'hasCompanionCrib',
        value: BedModeFieldValue
    ) => void;
    updateClinicalCrib: (bedId: string, field: 'create' | 'remove') => void;
}

interface BedConfigRuntimeDialogs {
    confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
    alert: (message: string, title?: string) => Promise<void>;
}

export interface ToggleBedModeExecutionParams {
    bedId: string;
    isCunaMode: boolean;
    hasCompanion: boolean;
    actions: Pick<BedConfigRuntimeActions, 'updatePatient'>;
    dialogs: Pick<BedConfigRuntimeDialogs, 'confirm'>;
}

export interface ToggleCompanionCribExecutionParams {
    bedId: string;
    isCunaMode: boolean;
    hasCompanion: boolean;
    actions: Pick<BedConfigRuntimeActions, 'updatePatient'>;
    dialogs: Pick<BedConfigRuntimeDialogs, 'alert'>;
}

export interface ToggleClinicalCribExecutionParams {
    bedId: string;
    hasClinicalCrib: boolean;
    actions: Pick<BedConfigRuntimeActions, 'updateClinicalCrib'>;
}

export type ToggleBedModeRuntimeResult = ControllerResult<
    { outcome: 'updated' | 'cancelled'; nextMode: 'Cama' | 'Cuna' },
    'CONFIRMATION_FAILED'
>;

export type ToggleCompanionRuntimeErrorCode =
    | PatientRowBedConfigErrorCode
    | 'ALERT_FAILED';

export type ToggleCompanionRuntimeError =
    | PatientRowBedConfigError
    | {
        code: 'ALERT_FAILED';
        message: string;
    };

export type ToggleCompanionRuntimeResult = ControllerResult<
    { outcome: 'updated'; nextValue: boolean },
    ToggleCompanionRuntimeErrorCode,
    ToggleCompanionRuntimeError
>;

export interface ToggleClinicalCribRuntimeResult {
    action: 'create' | 'remove';
}

export const executeToggleBedModeController = async ({
    bedId,
    isCunaMode,
    hasCompanion,
    actions,
    dialogs
}: ToggleBedModeExecutionParams): Promise<ToggleBedModeRuntimeResult> => {
    const command = resolveToggleBedModeCommand({ isCunaMode, hasCompanion });

    if (command.kind === 'confirmAndSetBedMode') {
        try {
            const confirmed = await dialogs.confirm(command.confirm);
            if (!confirmed) {
                return ok({
                    outcome: 'cancelled',
                    nextMode: command.nextMode
                });
            }
        } catch {
            return failWithCode('CONFIRMATION_FAILED', 'No se pudo confirmar el cambio de modo de cama.');
        }

        actions.updatePatient(bedId, 'hasCompanionCrib', command.companionPatch);
    }

    actions.updatePatient(bedId, 'bedMode', command.nextMode);
    return ok({
        outcome: 'updated',
        nextMode: command.nextMode
    });
};

export const executeToggleCompanionCribController = async ({
    bedId,
    isCunaMode,
    hasCompanion,
    actions,
    dialogs
}: ToggleCompanionCribExecutionParams): Promise<ToggleCompanionRuntimeResult> => {
    const resolution = resolveToggleCompanionCribCommand({ isCunaMode, hasCompanion });

    if (!resolution.ok) {
        try {
            await dialogs.alert(resolution.error.message, resolution.error.title);
        } catch {
            return failWithCode('ALERT_FAILED', 'No se pudo mostrar la alerta para RN Sano.');
        }
        return fail(resolution.error);
    }

    actions.updatePatient(bedId, 'hasCompanionCrib', resolution.value.nextValue);
    return ok({
        outcome: 'updated',
        nextValue: resolution.value.nextValue
    });
};

export const executeToggleClinicalCribController = ({
    bedId,
    hasClinicalCrib,
    actions
}: ToggleClinicalCribExecutionParams): ToggleClinicalCribRuntimeResult => {
    const command = resolveToggleClinicalCribCommand({ hasClinicalCrib });
    actions.updateClinicalCrib(bedId, command.action);

    return {
        action: command.action
    };
};
