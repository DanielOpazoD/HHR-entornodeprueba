import type { ControllerConfirmDescriptor } from '@/shared/contracts/controllers/confirmDescriptor';
import {
  type ControllerResult,
  failWithCode,
  ok,
} from '@/features/census/controllers/controllerResult';
import {
  canDeleteTodayDailyRecord,
  canResetOrDeleteDailyRecord,
  isAdminAppRole,
} from '@/shared/access/operationalAccessPolicy';

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
const NON_ADMIN_OLD_DATE_MESSAGE =
  'Solo el administrador puede eliminar registros de días anteriores. Los enfermeros solo pueden reiniciar el día actual.';

export const resolveResetDayPermission = ({
  role,
  isToday,
}: ResolveResetDayPermissionParams): ResetDayPermissionResult => {
  if (canResetOrDeleteDailyRecord({ role, isToday })) {
    return {
      canDeleteRecord: true,
      denialTitle: DELETE_DENIED_TITLE,
      denialMessage: '',
    };
  }

  if (isAdminAppRole(role)) {
    return {
      canDeleteRecord: true,
      denialTitle: DELETE_DENIED_TITLE,
      denialMessage: '',
    };
  }

  if (!isToday) {
    return {
      canDeleteRecord: false,
      denialTitle: DELETE_DENIED_TITLE,
      denialMessage: NON_ADMIN_OLD_DATE_MESSAGE,
    };
  }

  if (!canDeleteTodayDailyRecord(role)) {
    return {
      canDeleteRecord: false,
      denialTitle: DELETE_DENIED_TITLE,
      denialMessage: NO_PERMISSION_MESSAGE,
    };
  }

  return {
    canDeleteRecord: true,
    denialTitle: DELETE_DENIED_TITLE,
    denialMessage: '',
  };
};

export interface ResetDayMenuEntryState {
  visible: boolean;
  enabled: boolean;
  title: string;
}

/** Read-only viewers without the permission do not see the entry; others see why it is off. */
export const resolveResetDayMenuEntryState = ({
  readOnly,
  canDeleteRecord,
  deniedMessage,
}: {
  readOnly: boolean;
  canDeleteRecord: boolean;
  deniedMessage: string;
}): ResetDayMenuEntryState => ({
  visible: !readOnly || canDeleteRecord,
  enabled: canDeleteRecord,
  title: canDeleteRecord ? 'Eliminar todos los datos del día' : deniedMessage,
});

export const RESET_DAY_CONFIRM_DIALOG: ControllerConfirmDescriptor = {
  title: 'Reiniciar registro del día',
  message:
    '¿Está seguro de que desea ELIMINAR todos los datos del día?\n\nEsto eliminará el registro completo y podrá crear uno nuevo (copiar del anterior o en blanco).',
  confirmText: 'Sí, reiniciar',
  cancelText: 'Cancelar',
  variant: 'danger',
  requireInputConfirm: 'Eliminardia',
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
    return failWithCode('CONFIRMATION_FAILED', 'No se pudo confirmar el reinicio del registro.');
  }
};
