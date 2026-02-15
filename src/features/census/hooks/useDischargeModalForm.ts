import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_DISCHARGE_TYPE, type DischargeStatus, type DischargeType } from '@/constants';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';
import {
  buildDischargeConfirmPayload,
  buildInitialDischargeFormState,
  hasDischargeValidationErrors,
  mapDischargeValidationErrors,
  type DischargeConfirmPayload,
  type DischargeModalFieldErrors,
} from '@/features/census/controllers/dischargeModalController';
import {
  isMovementDateTimeAllowed,
  resolveMovementDateTimeBounds,
} from '@/features/census/controllers/censusMovementDatePresentationController';
import { useLatestRef } from '@/hooks/useLatestRef';

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
  const [dischargeType, setDischargeTypeState] = useState<DischargeType>(DEFAULT_DISCHARGE_TYPE);
  const [otherDetails, setOtherDetailsState] = useState('');
  const [dischargeDate, setDischargeDateState] = useState('');
  const [dischargeTime, setDischargeTimeState] = useState('');
  const [localTarget, setLocalTargetState] = useState<DischargeTarget>(dischargeTarget);
  const [errors, setErrors] = useState<DischargeModalFieldErrors>({});
  const movementBounds = resolveMovementDateTimeBounds(recordDate);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const initialState = buildInitialDischargeFormState({
      recordDate,
      initialMovementDate,
      initialType,
      initialOtherDetails,
      initialTime,
      defaultTime: resolveDefaultTimeRef.current(),
      dischargeTarget,
    });

    setDischargeTypeState(initialState.dischargeType);
    setOtherDetailsState(initialState.otherDetails);
    setDischargeDateState(initialState.movementDate);
    setDischargeTimeState(initialState.dischargeTime);
    setLocalTargetState(initialState.localTarget);
    setErrors({});
  }, [
    dischargeTarget,
    initialMovementDate,
    initialOtherDetails,
    initialTime,
    initialType,
    isOpen,
    recordDate,
    resolveDefaultTimeRef,
  ]);

  const setDischargeType = useCallback((nextType: DischargeType) => {
    setDischargeTypeState(nextType);
    setErrors(prev => ({ ...prev, other: undefined }));
  }, []);

  const setOtherDetails = useCallback((nextDetails: string) => {
    setOtherDetailsState(nextDetails);
    setErrors(prev => ({ ...prev, other: undefined }));
  }, []);

  const setDischargeTime = useCallback((nextTime: string) => {
    setDischargeTimeState(nextTime);
    setErrors(prev => ({ ...prev, time: undefined, dateTime: undefined }));
  }, []);

  const setDischargeDate = useCallback((nextDate: string) => {
    setDischargeDateState(nextDate);
    setErrors(prev => ({ ...prev, dateTime: undefined }));
  }, []);

  const setLocalTarget = useCallback((nextTarget: DischargeTarget) => {
    setLocalTargetState(nextTarget);
  }, []);

  const submit = useCallback((): boolean => {
    const fieldErrors = mapDischargeValidationErrors(
      status,
      dischargeType,
      otherDetails,
      dischargeTime
    );
    if (
      includeMovementDate &&
      !isMovementDateTimeAllowed(recordDate, dischargeDate, dischargeTime)
    ) {
      fieldErrors.dateTime = 'Fecha/hora fuera de rango para el turno.';
    }

    if (hasDischargeValidationErrors(fieldErrors)) {
      setErrors(fieldErrors);
      return false;
    }

    onConfirm(
      buildDischargeConfirmPayload({
        status,
        dischargeType,
        otherDetails,
        dischargeTime,
        movementDate: includeMovementDate ? dischargeDate : undefined,
        hasClinicalCrib,
        localTarget,
      })
    );

    return true;
  }, [
    dischargeDate,
    dischargeTime,
    dischargeType,
    hasClinicalCrib,
    includeMovementDate,
    localTarget,
    onConfirm,
    otherDetails,
    recordDate,
    status,
  ]);

  return {
    dischargeType,
    otherDetails,
    dischargeDate,
    dischargeTime,
    movementBounds,
    localTarget,
    errors,
    setDischargeType,
    setOtherDetails,
    setDischargeDate,
    setDischargeTime,
    setLocalTarget,
    submit,
  };
};
