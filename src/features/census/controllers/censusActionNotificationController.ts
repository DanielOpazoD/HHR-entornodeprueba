import {
  getDischargeErrorTitle,
  getMoveOrCopyErrorTitle,
  getTransferErrorTitle,
} from '@/features/census/controllers/censusActionErrorPresentation';
import type {
  CensusActionErrorCode,
  MoveOrCopyRuntimeErrorCode,
} from '@/features/census/types/censusActionCommandContracts';

export interface CensusActionNotification {
  title: string;
  message: string;
}

export const buildRowActionBlockedNotification = (message: string): CensusActionNotification => ({
  title: 'Acción bloqueada',
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
