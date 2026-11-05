import {
  getDischargeErrorTitle,
  getMoveOrCopyErrorTitle,
  getTransferErrorTitle,
} from '@/features/census/controllers/censusActionErrorPresentation';
import type {
  CensusActionErrorCode,
  MoveOrCopyRuntimeErrorCode,
} from '@/features/census/domain/movements/contracts';

export interface CensusActionNotification {
  title: string;
  message: string;
}

export const buildRowActionBlockedNotification = (message: string): CensusActionNotification => ({
  title: 'Acción bloqueada',
  message,
});

/** Today is already clean; only the previous day may still hold the episode. */
export const PREVIOUS_DAY_UNCHECKED_MESSAGE =
  'Se eliminó de este día, pero no se pudo revisar el día anterior. Ábrelo y usa «Paciente no válido» si el paciente aparece ahí.';

export const buildPreviousDayPendingNotification = (message: string): CensusActionNotification => ({
  title: 'Revisar el día anterior',
  message,
});

export const buildRowActionUnexpectedNotification = (): CensusActionNotification => ({
  title: 'No se pudo ejecutar la acción',
  message: 'Ocurrió un error inesperado al procesar la acción del paciente.',
});

export const buildMoveOrCopyErrorNotification = (
  errorCode: MoveOrCopyRuntimeErrorCode,
  message: string
): CensusActionNotification => ({
  title: getMoveOrCopyErrorTitle(errorCode),
  message,
});

export const buildMoveOrCopyUnexpectedNotification = (): CensusActionNotification => ({
  title: 'No se pudo mover/copiar',
  message: 'Ocurrió un error inesperado al ejecutar la acción.',
});

export const buildDischargeErrorNotification = (
  errorCode: CensusActionErrorCode,
  message: string
): CensusActionNotification => ({
  title: getDischargeErrorTitle(errorCode),
  message,
});

export const buildTransferErrorNotification = (
  errorCode: CensusActionErrorCode,
  message: string
): CensusActionNotification => ({
  title: getTransferErrorTitle(errorCode),
  message,
});
