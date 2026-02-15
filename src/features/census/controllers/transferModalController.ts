import {
  DEFAULT_TRANSFER_ESCORT,
  EVACUATION_METHOD_COMMERCIAL,
  EVACUATION_METHOD_OTHER,
  type EvacuationMethod,
  type ReceivingCenter,
} from '@/constants';
import { validateTransferExecutionInput } from '@/features/census/validation/censusActionValidation';
import {
  isMovementDateTimeAllowed,
  resolveMovementEditorInitialDate,
} from '@/features/census/controllers/censusMovementDatePresentationController';

export interface TransferModalFieldErrors {
  time?: string;
  otherCenter?: string;
  otherEvacuation?: string;
  escort?: string;
  dateTime?: string;
}

interface BuildTransferValidationErrorsParams {
  recordDate: string;
  movementDate: string;
  evacuationMethod: EvacuationMethod;
  evacuationMethodOther: string;
  receivingCenter: ReceivingCenter;
  receivingCenterOther: string;
  transferEscort: string;
  transferTime: string;
}

interface ResolveTransferMethodChangeEffectsParams {
  nextMethod: string;
}

export interface TransferMethodChangeEffects {
  nextTransferEscort?: string;
  shouldClearEvacuationMethodOther: boolean;
}

export const resolveTransferInitialTime = (
  initialTime: string | undefined,
  defaultTime: string
): string => initialTime || defaultTime;

export const resolveTransferInitialMovementDate = (
  recordDate: string,
  initialMovementDate: string | undefined,
  initialTime: string | undefined
): string => resolveMovementEditorInitialDate(recordDate, initialMovementDate, initialTime);

export const buildTransferValidationErrors = ({
  recordDate,
  movementDate,
  evacuationMethod,
  evacuationMethodOther,
  receivingCenter,
  receivingCenterOther,
  transferEscort,
  transferTime,
}: BuildTransferValidationErrorsParams): TransferModalFieldErrors => {
  const fieldErrors: TransferModalFieldErrors = {};
  const validationErrors = validateTransferExecutionInput({
    evacuationMethod,
    evacuationMethodOther,
    receivingCenter,
    receivingCenterOther,
    transferEscort,
    time: transferTime,
  });

  validationErrors.forEach(validationError => {
    if (validationError.field === 'time') {
      fieldErrors.time = validationError.message;
    }
    if (validationError.field === 'receivingCenterOther') {
      fieldErrors.otherCenter = validationError.message;
    }
    if (validationError.field === 'evacuationMethodOther') {
      fieldErrors.otherEvacuation = validationError.message;
    }
    if (validationError.field === 'transferEscort') {
      fieldErrors.escort = validationError.message;
    }
  });

  if (
    recordDate &&
    movementDate &&
    !isMovementDateTimeAllowed(recordDate, movementDate, transferTime)
  ) {
    fieldErrors.dateTime = 'Fecha/hora fuera de rango para el turno.';
  }

  return fieldErrors;
};

export const hasTransferValidationErrors = (fieldErrors: TransferModalFieldErrors): boolean =>
  Object.keys(fieldErrors).length > 0;

export const resolveTransferMethodChangeEffects = ({
  nextMethod,
}: ResolveTransferMethodChangeEffectsParams): TransferMethodChangeEffects => ({
  nextTransferEscort:
    nextMethod === EVACUATION_METHOD_COMMERCIAL ? DEFAULT_TRANSFER_ESCORT : undefined,
  shouldClearEvacuationMethodOther: nextMethod !== EVACUATION_METHOD_OTHER,
});
