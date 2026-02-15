import type {
  CensusActionErrorCode,
  MoveOrCopyRuntimeErrorCode,
} from '@/features/census/domain/movements/contracts';

const VALIDATION_ERROR_CODES = new Set<CensusActionErrorCode>([
  'INVALID_TIME_FORMAT',
  'DISCHARGE_TYPE_OTHER_REQUIRED',
  'TRANSFER_EVACUATION_METHOD_OTHER_REQUIRED',
  'TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED',
  'TRANSFER_ESCORT_REQUIRED',
]);

export const getMoveOrCopyErrorTitle = (errorCode: MoveOrCopyRuntimeErrorCode): string => {
  if (errorCode === 'COPY_TO_DATE_FAILED') {
    return 'No se pudo copiar';
  }

  return 'No se pudo mover/copiar';
};

export const getDischargeErrorTitle = (errorCode: CensusActionErrorCode): string => {
  if (VALIDATION_ERROR_CODES.has(errorCode)) {
    return 'Datos de alta incompletos';
  }

  if (errorCode === 'ACTIONS_LOCKED') {
    return 'Alta bloqueada';
  }

  return 'No se pudo registrar el alta';
};

export const getTransferErrorTitle = (errorCode: CensusActionErrorCode): string => {
  if (VALIDATION_ERROR_CODES.has(errorCode)) {
    return 'Datos de traslado incompletos';
  }

  if (errorCode === 'ACTIONS_LOCKED') {
    return 'Traslado bloqueado';
  }

  return 'No se pudo registrar el traslado';
};
