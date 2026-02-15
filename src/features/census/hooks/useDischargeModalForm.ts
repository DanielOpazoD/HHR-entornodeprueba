import { useCallback } from 'react';
import { type DischargeStatus, type DischargeType } from '@/constants';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';
import {
  buildDischargeConfirmPayload,
  buildInitialDischargeFormState,
  mapDischargeValidationErrors,
  type DischargeConfirmPayload,
  type DischargeModalFieldErrors,
} from '@/features/census/controllers/dischargeModalController';
import {
  resolveMovementDateTimeValidationError,
  resolveMovementDateTimeBounds,
} from '@/features/census/controllers/clinicalShiftCalendarController';
import { useLatestRef } from '@/hooks/useLatestRef';
import { useModalFormFlow } from '@/features/census/hooks/useModalFormFlow';

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
  hasClinicalCrib?: boolean;
  resolveDefaultTime: () => string;
  onConfirm: (payload: DischargeConfirmPayload) => void;
}

interface UseDischargeModalFormResult {
  dischargeType: DischargeType;
  otherDetails: string;
  dischargeDate: string;
  dischargeTime: string;
  movementBounds: ReturnType<typeof resolveMovementDateTimeBounds>;
  localTarget: DischargeTarget;
  errors: DischargeModalFieldErrors;
  setDischargeType: (nextType: DischargeType) => void;
  setOtherDetails: (nextDetails: string) => void;
  setDischargeDate: (nextDate: string) => void;
  setDischargeTime: (nextTime: string) => void;
  setLocalTarget: (nextTarget: DischargeTarget) => void;
  submit: () => boolean;
}

interface DischargeModalLocalFormState {
  dischargeType: DischargeType;
  otherDetails: string;
  dischargeDate: string;
  dischargeTime: string;
  localTarget: DischargeTarget;
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
    };
  }, [
    dischargeTarget,
    initialMovementDate,
    initialOtherDetails,
    initialTime,
    initialType,
    recordDate,
    resolveDefaultTimeRef,
  ]);

  const createInitialErrors = useCallback((): DischargeModalFieldErrors => ({}), []);

  const { formState, errors, setFormField, submit } = useModalFormFlow<
    DischargeModalLocalFormState,
    DischargeModalFieldErrors,
    DischargeConfirmPayload
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

  return {
    dischargeType: formState.dischargeType,
    otherDetails: formState.otherDetails,
    dischargeDate: formState.dischargeDate,
    dischargeTime: formState.dischargeTime,
    movementBounds,
    localTarget: formState.localTarget,
    errors,
    setDischargeType,
    setOtherDetails,
    setDischargeDate,
    setDischargeTime,
    setLocalTarget,
    submit,
  };
};
