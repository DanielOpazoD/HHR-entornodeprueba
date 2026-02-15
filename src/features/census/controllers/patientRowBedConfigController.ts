import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';
import {
    ControllerError,
    ControllerResult,
    fail,
    ok
} from '@/features/census/controllers/controllerResult';

export type PatientRowConfirmDescriptor = ControllerConfirmDescriptor;

export type PatientRowBedConfigErrorCode = 'COMPANION_NOT_ALLOWED_IN_CUNA';

export interface PatientRowBedConfigError extends ControllerError<PatientRowBedConfigErrorCode> {
    title: string;
}

export type PatientRowBedModeCommand =
    | { kind: 'setBedMode'; nextMode: 'Cama' | 'Cuna' }
    | {
        kind: 'confirmAndSetBedMode';
        nextMode: 'Cuna';
        companionPatch: false;
        confirm: PatientRowConfirmDescriptor;
    };

export type PatientRowCompanionCommand = { kind: 'toggleCompanion'; nextValue: boolean };
export type PatientRowCompanionResult = ControllerResult<
    PatientRowCompanionCommand,
    PatientRowBedConfigErrorCode,
    PatientRowBedConfigError
>;

export type PatientRowClinicalCribCommand = {
    kind: 'toggleClinicalCrib';
    action: 'create' | 'remove';
};

interface ResolveBedModeParams {
    isCunaMode: boolean;
    hasCompanion: boolean;
}

interface ResolveCompanionParams {
    isCunaMode: boolean;
    hasCompanion: boolean;
}

interface ResolveClinicalCribParams {
    hasClinicalCrib: boolean;
}

export const resolveToggleBedModeCommand = ({
    isCunaMode,
    hasCompanion
}: ResolveBedModeParams): PatientRowBedModeCommand => {
    if (!isCunaMode && hasCompanion) {
        return {
            kind: 'confirmAndSetBedMode',
            nextMode: 'Cuna',
            companionPatch: false,
            confirm: {
                title: 'Cambiar a modo Cuna',
                message: "El 'Modo Cuna clínica' (Paciente principal) no suele ser compatible con 'RN Sano' (Acompañante). ¿Desea desactivar RN Sano y continuar?",
                confirmText: 'Sí, continuar',
                cancelText: 'Cancelar',
                variant: 'warning'
            }
        };
    }

    return {
        kind: 'setBedMode',
        nextMode: isCunaMode ? 'Cama' : 'Cuna'
    };
};

export const resolveToggleCompanionCribCommand = ({
    isCunaMode,
    hasCompanion
}: ResolveCompanionParams): PatientRowCompanionResult => {
    if (isCunaMode) {
        return fail({
            code: 'COMPANION_NOT_ALLOWED_IN_CUNA',
            title: 'Acción no permitida',
            message: "No se puede agregar 'RN Sano' si la cama principal está en 'Modo Cuna clínica'. Use el modo Cama para la madre."
        });
    }

    return ok({
        kind: 'toggleCompanion',
        nextValue: !hasCompanion
    });
};

export const resolveToggleClinicalCribCommand = ({
    hasClinicalCrib
}: ResolveClinicalCribParams): PatientRowClinicalCribCommand => ({
    kind: 'toggleClinicalCrib',
    action: hasClinicalCrib ? 'remove' : 'create'
});
