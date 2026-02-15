import {
  DISCHARGE_TYPE_OTHER,
  DEFAULT_DISCHARGE_TYPE,
  type DischargeStatus,
  type DischargeType,
} from '@/constants';
import { validateDischargeExecutionInput } from '@/features/census/validation/censusActionValidation';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';
import { resolveMovementEditorInitialDate } from '@/features/census/controllers/clinicalShiftCalendarController';
import { resolveValidHourMinuteOrFallback } from '@/features/census/controllers/timeInputController';
import { hasModalFieldErrors } from '@/features/census/controllers/modalFormController';

export interface DischargeModalFieldErrors {
  time?: string;
  other?: string;
  dateTime?: string;
}

interface BuildInitialDischargeFormStateParams {
  recordDate: string;
  initialMovementDate?: string;
  initialType?: string;
  initialOtherDetails?: string;
  initialTime?: string;
  defaultTime: string;
  dischargeTarget: DischargeTarget;
}

export interface DischargeModalFormState {
  dischargeType: DischargeType;
  otherDetails: string;
  dischargeTime: string;
  movementDate: string;
  localTarget: DischargeTarget;
}

interface BuildDischargeConfirmPayloadParams {
  status: DischargeStatus;
  dischargeType: DischargeType;
  otherDetails: string;
  dischargeTime: string;
  movementDate?: string;
  hasClinicalCrib?: boolean;
  localTarget: DischargeTarget;
}

export interface DischargeConfirmPayload {
  status: DischargeStatus;
  type?: string;
  typeOther?: string;
  time: string;
  movementDate?: string;
  dischargeTarget?: DischargeTarget;
}

export const buildInitialDischargeFormState = ({
  recordDate,
  initialMovementDate,
  initialType,
  initialOtherDetails,
  initialTime,
  defaultTime,
  dischargeTarget,
}: BuildInitialDischargeFormStateParams): DischargeModalFormState => ({
  dischargeType: (initialType as DischargeType) || DEFAULT_DISCHARGE_TYPE,
  otherDetails: initialOtherDetails || '',
  dischargeTime: resolveValidHourMinuteOrFallback(initialTime, defaultTime),
  movementDate: resolveMovementEditorInitialDate(recordDate, initialMovementDate, initialTime),
  localTarget: dischargeTarget,
});

export const mapDischargeValidationErrors = (
  status: DischargeStatus,
  dischargeType: DischargeType,
  otherDetails: string,
  dischargeTime: string
): DischargeModalFieldErrors => {
  const fieldErrors: DischargeModalFieldErrors = {};
  const validationErrors = validateDischargeExecutionInput({
    status,
    type: status === 'Vivo' ? dischargeType : undefined,
    typeOther: otherDetails,
    time: dischargeTime,
  });

  validationErrors.forEach(validationError => {
    if (validationError.field === 'time') {
      fieldErrors.time = validationError.message;
    }
    if (validationError.field === 'typeOther') {
      fieldErrors.other = validationError.message;
    }
  });

  return fieldErrors;
};

export const hasDischargeValidationErrors = (fieldErrors: DischargeModalFieldErrors): boolean =>
  hasModalFieldErrors(fieldErrors);

export const buildDischargeConfirmPayload = ({
  status,
  dischargeType,
  otherDetails,
  dischargeTime,
  movementDate,
  hasClinicalCrib,
  localTarget,
}: BuildDischargeConfirmPayloadParams): DischargeConfirmPayload => ({
  status,
  type: status === 'Vivo' ? dischargeType : undefined,
  typeOther: status === 'Vivo' && dischargeType === DISCHARGE_TYPE_OTHER ? otherDetails : undefined,
  time: dischargeTime,
  movementDate,
  dischargeTarget: hasClinicalCrib ? localTarget : undefined,
});

export const shouldShowMotherStatus = (target: DischargeTarget): boolean =>
  target === 'mother' || target === 'both';

export const shouldShowBabyStatus = (target: DischargeTarget, hasClinicalCrib?: boolean): boolean =>
  (target === 'baby' || target === 'both') && Boolean(hasClinicalCrib);
