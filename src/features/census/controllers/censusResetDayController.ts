import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';
import {
    type ControllerResult,
    failWithCode,
    ok
} from '@/features/census/controllers/controllerResult';
import { ACTIONS, canDoAction, isAdmin } from '@/utils/permissions';

export interface ResetDayPermissionResult {
    canDeleteRecord: boolean;
    denialTitle: string;
    denialMessage: string;
}

export interface ResetDayRuntimeActions {
    warning: (title: string, message: string) => void;
    confirm: (descriptor: ControllerConfirmDescriptor) => Promise<boolean>;
    resetDay: () => void;
}

export type ResetDayExecutionOutcome = 'denied' | 'cancelled' | 'reset';
export type ResetDayRuntimeResult = ControllerResult<
    { outcome: ResetDayExecutionOutcome },
    'CONFIRMATION_FAILED'
>;

interface ResolveResetDayPermissionParams {
    role: string | undefined;
    isToday: boolean;
}

const DELETE_DENIED_TITLE = 'Acceso Denegado';

const NO_PERMISSION_MESSAGE = 'No tienes permisos para reiniciar este registro.';
const NON_ADMIN_OLD_DATE_MESSAGE = 'Solo el administrador puede eliminar registros de días anteriores. Los enfermeros solo pueden reiniciar el día actual.';

export const resolveResetDayPermission = ({
    role,
    isToday
}: ResolveResetDayPermissionParams): ResetDayPermissionResult => {
    if (isAdmin(role)) {
        return {
            canDeleteRecord: true,
            denialTitle: DELETE_DENIED_TITLE,
            denialMessage: ''
        };
    }

    if (!isToday) {
        return {
            canDeleteRecord: false,
            denialTitle: DELETE_DENIED_TITLE,
            denialMessage: NON_ADMIN_OLD_DATE_MESSAGE
        };
    }

    if (!canDoAction(role, ACTIONS.RECORD_DELETE)) {
        return {
            canDeleteRecord: false,
            denialTitle: DELETE_DENIED_TITLE,
            denialMessage: NO_PERMISSION_MESSAGE
        };
    }

    return {
        canDeleteRecord: true,
        denialTitle: DELETE_DENIED_TITLE,
        denialMessage: ''
    };
};

export const RESET_DAY_CONFIRM_DIALOG: ControllerConfirmDescriptor = {
    title: '⚠️ Reiniciar registro del día',
    message: '¿Está seguro de que desea ELIMINAR todos los datos del día?\n\nEsto eliminará el registro completo y podrá crear uno nuevo (copiar del anterior o en blanco).',
    confirmText: 'Sí, reiniciar',
    cancelText: 'Cancelar',
    variant: 'danger'
};

export const executeResetDayController = async (
    permission: ResetDayPermissionResult,
    actions: ResetDayRuntimeActions
): Promise<ResetDayRuntimeResult> => {
    if (!permission.canDeleteRecord) {
        actions.warning(permission.denialTitle, permission.denialMessage);
        return ok({ outcome: 'denied' });
    }

    try {
        const confirmed = await actions.confirm(RESET_DAY_CONFIRM_DIALOG);
        if (!confirmed) {
            return ok({ outcome: 'cancelled' });
        }

        actions.resetDay();
        return ok({ outcome: 'reset' });
    } catch {
        return failWithCode(
            'CONFIRMATION_FAILED',
            'No se pudo confirmar el reinicio del registro.'
        );
    }
};
