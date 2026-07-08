import { useCallback } from 'react';
import type { DischargeStatus, DischargeType } from '@/constants/clinicalMovementConstants';
import type { DischargeModalConfirmPayload, DischargeTarget } from '@/types/movements';
import {
  buildDischargeConfirmPayload,
  buildInitialDischargeFormState,
  mapDischargeValidationErrors,
  type DischargeModalFieldErrors,
} from '@/application/census/public';
import {
  resolveMovementDateTimeValidationError,
  resolveMovementDateTimeBounds,
} from '@/hooks/controllers/clinicalShiftCalendarController';
import { useLatestRef } from '@/hooks/useLatestRef';
import { useModalFormFlow } from '@/hooks/useModalFormFlow';

interface UseDischargeModalFormParams {
  isOpen: boolean;
  status: DischargeStatus;
  recordDate: string;
  includeMovementDate: boolean;
  initialMovementDate?: string;
  initialType?: string;
  initialOtherDetails?: string;
  initialTime?: string;
  dischargeTarget: DischargeTarget;
  initialDiagnosis?: string;
  hasClinicalCrib?: boolean;
  resolveDefaultTime: () => string;
  onConfirm: (payload: DischargeModalConfirmPayload) => void;
}

interface UseDischargeModalFormResult {
  dischargeType: DischargeType;
  otherDetails: string;
  dischargeDate: string;
  dischargeTime: string;
  movementBounds: ReturnType<typeof resolveMovementDateTimeBounds>;
  localTarget: DischargeTarget;
  diagnosis: string;
  errors: DischargeModalFieldErrors;
  setDischargeType: (nextType: DischargeType) => void;
  setOtherDetails: (nextDetails: string) => void;
  setDischargeDate: (nextDate: string) => void;
  setDischargeTime: (nextTime: string) => void;
  setLocalTarget: (nextTarget: DischargeTarget) => void;
  setDiagnosis: (nextDiagnosis: string) => void;
  submit: () => boolean;
}

interface DischargeModalLocalFormState {
  dischargeType: DischargeType;
  otherDetails: string;
  dischargeDate: string;
  dischargeTime: string;
  localTarget: DischargeTarget;
  diagnosis: string;
}

export const useDischargeModalForm = ({
  isOpen,
  status,
  recordDate,
  includeMovementDate,
  initialMovementDate,
  initialType,
  initialOtherDetails,
  initialTime,
  dischargeTarget,
  initialDiagnosis,
  hasClinicalCrib,
  resolveDefaultTime,
  onConfirm,
}: UseDischargeModalFormParams): UseDischargeModalFormResult => {
  const resolveDefaultTimeRef = useLatestRef(resolveDefaultTime);
  const movementBounds = resolveMovementDateTimeBounds(recordDate);

  const resolveInitialState = useCallback((): DischargeModalLocalFormState => {
    const initialState = buildInitialDischargeFormState({
      recordDate,
      initialMovementDate,
      initialType,
      initialOtherDetails,
      initialTime,
      defaultTime: resolveDefaultTimeRef.current(),
      dischargeTarget,
    });
    return {
      dischargeType: initialState.dischargeType,
      otherDetails: initialState.otherDetails,
      dischargeDate: initialState.movementDate,
      dischargeTime: initialState.dischargeTime,
      localTarget: initialState.localTarget,
      diagnosis: initialDiagnosis || '',
    };
  }, [
    dischargeTarget,
    initialMovementDate,
    initialOtherDetails,
    initialTime,
    initialType,
    initialDiagnosis,
    recordDate,
    resolveDefaultTimeRef,
  ]);

  const createInitialErrors = useCallback((): DischargeModalFieldErrors => ({}), []);

  const { formState, errors, setFormField, submit } = useModalFormFlow<
    DischargeModalLocalFormState,
    DischargeModalFieldErrors,
    DischargeModalConfirmPayload
  >({
    isOpen,
    resolveInitialState,
    createInitialErrors,
    validate: state => {
      const fieldErrors = mapDischargeValidationErrors(
        status,
        state.dischargeType,
        state.otherDetails,
        state.dischargeTime
      );

      if (includeMovementDate) {
        const dateTimeError = resolveMovementDateTimeValidationError({
          recordDate,
          movementDate: state.dischargeDate,
          movementTime: state.dischargeTime,
        });
        if (dateTimeError) {
          fieldErrors.dateTime = dateTimeError;
        }
      }

      return fieldErrors;
    },
    buildPayload: state =>
      buildDischargeConfirmPayload({
        status,
        dischargeType: state.dischargeType,
        otherDetails: state.otherDetails,
        dischargeTime: state.dischargeTime,
        movementDate: includeMovementDate ? state.dischargeDate : undefined,
        hasClinicalCrib,
        localTarget: state.localTarget,
        diagnosis: includeMovementDate ? state.diagnosis : undefined,
      }),
    onConfirm,
  });

  const setDischargeType = useCallback(
    (nextType: DischargeType) => {
      setFormField('dischargeType', nextType, ['other']);
    },
    [setFormField]
  );

  const setOtherDetails = useCallback(
    (nextDetails: string) => {
      setFormField('otherDetails', nextDetails, ['other']);
    },
    [setFormField]
  );

  const setDischargeTime = useCallback(
    (nextTime: string) => {
      setFormField('dischargeTime', nextTime, ['time', 'dateTime']);
    },
    [setFormField]
  );

  const setDischargeDate = useCallback(
    (nextDate: string) => {
      setFormField('dischargeDate', nextDate, ['dateTime']);
    },
    [setFormField]
  );

  const setLocalTarget = useCallback(
    (nextTarget: DischargeTarget) => {
      setFormField('localTarget', nextTarget);
    },
    [setFormField]
  );

  const setDiagnosis = useCallback(
    (nextDiagnosis: string) => {
      setFormField('diagnosis', nextDiagnosis);
    },
    [setFormField]
  );

  return {
    dischargeType: formState.dischargeType,
    otherDetails: formState.otherDetails,
    dischargeDate: formState.dischargeDate,
    dischargeTime: formState.dischargeTime,
    movementBounds,
    localTarget: formState.localTarget,
    diagnosis: formState.diagnosis,
    errors,
    setDischargeType,
    setOtherDetails,
    setDischargeDate,
    setDischargeTime,
    setLocalTarget,
    setDiagnosis,
    submit,
  };
};
