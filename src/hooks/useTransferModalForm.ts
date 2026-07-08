import { useCallback, useMemo } from 'react';
import type { EvacuationMethod, ReceivingCenter } from '@/constants/clinicalMovementConstants';
import { isTransferEscortOption } from '@/constants/clinicalMovementConstants';
import {
  buildTransferValidationErrors,
  resolveTransferInitialMovementDate,
  resolveTransferInitialTime,
  resolveTransferMethodChangeEffects,
  type TransferModalFieldErrors,
} from '@/application/census/public';
import { resolveMovementDateTimeBounds } from '@/hooks/controllers/clinicalShiftCalendarController';
import { useLatestRef } from '@/hooks/useLatestRef';
import type { TransferModalConfirmPayload } from '@/types/movements';
import type { TransferUpdateField } from '@/hooks/types/censusActionModalContracts';
import { useModalFormFlow } from '@/hooks/useModalFormFlow';

interface UseTransferModalFormParams {
  isOpen: boolean;
  recordDate: string;
  includeMovementDate: boolean;
  initialTime?: string;
  initialMovementDate?: string;
  evacuationMethod: EvacuationMethod;
  evacuationMethodOther: string;
  receivingCenter: ReceivingCenter;
  receivingCenterOther: string;
  transferEscort: string;
  diagnosis?: string;
  onUpdate: (field: TransferUpdateField, value: string) => void;
  onConfirm: (data: TransferModalConfirmPayload) => void;
  resolveDefaultTime: () => string;
}

interface UseTransferModalFormResult {
  transferDate: string;
  transferTime: string;
  movementBounds: ReturnType<typeof resolveMovementDateTimeBounds>;
  errors: TransferModalFieldErrors;
  isPredefinedEscort: boolean;
  setTransferDate: (nextDate: string) => void;
  setTransferTime: (nextTime: string) => void;
  setReceivingCenterOther: (value: string) => void;
  setEvacuationMethodOther: (value: string) => void;
  setTransferEscortValue: (value: string) => void;
  handleEscortChange: (value: string) => void;
  handleEvacuationChange: (value: string) => void;
  submit: () => boolean;
}

interface TransferModalLocalFormState {
  transferDate: string;
  transferTime: string;
}

const useTransferModalFieldUpdater = (
  onUpdate: UseTransferModalFormParams['onUpdate'],
  clearErrors: (fields: readonly (keyof TransferModalFieldErrors)[]) => void
) =>
  useCallback(
    (
      field: TransferUpdateField,
      errorKeys: Array<keyof TransferModalFieldErrors>,
      value: string
    ) => {
      onUpdate(field, value);
      clearErrors(errorKeys);
    },
    [clearErrors, onUpdate]
  );

export const useTransferModalForm = ({
  isOpen,
  recordDate,
  includeMovementDate,
  initialTime,
  initialMovementDate,
  evacuationMethod,
  evacuationMethodOther,
  receivingCenter,
  receivingCenterOther,
  transferEscort,
  diagnosis,
  onUpdate,
  onConfirm,
  resolveDefaultTime,
}: UseTransferModalFormParams): UseTransferModalFormResult => {
  const resolveDefaultTimeRef = useLatestRef(resolveDefaultTime);
  const movementBounds = resolveMovementDateTimeBounds(recordDate);

  const resolveInitialState = useCallback(
    (): TransferModalLocalFormState => ({
      transferDate: resolveTransferInitialMovementDate(
        recordDate,
        initialMovementDate,
        initialTime
      ),
      transferTime: resolveTransferInitialTime(initialTime, resolveDefaultTimeRef.current()),
    }),
    [initialMovementDate, initialTime, recordDate, resolveDefaultTimeRef]
  );

  const createInitialErrors = useCallback((): TransferModalFieldErrors => ({}), []);

  const { formState, errors, setFormField, clearErrors, submit } = useModalFormFlow<
    TransferModalLocalFormState,
    TransferModalFieldErrors,
    TransferModalConfirmPayload
  >({
    isOpen,
    resolveInitialState,
    createInitialErrors,
    validate: state =>
      buildTransferValidationErrors({
        recordDate,
        movementDate: includeMovementDate ? state.transferDate : '',
        evacuationMethod,
        evacuationMethodOther,
        receivingCenter,
        receivingCenterOther,
        transferEscort,
        transferTime: state.transferTime,
      }),
    buildPayload: state => ({
      time: state.transferTime,
      movementDate: includeMovementDate ? state.transferDate : undefined,
      diagnosis,
    }),
    onConfirm,
  });

  const updateTransferField = useTransferModalFieldUpdater(onUpdate, clearErrors);

  const setTransferDate = useCallback(
    (nextDate: string) => {
      setFormField('transferDate', nextDate, ['dateTime']);
    },
    [setFormField]
  );

  const setTransferTime = useCallback(
    (nextTime: string) => {
      setFormField('transferTime', nextTime, ['time', 'dateTime']);
    },
    [setFormField]
  );

  const setReceivingCenterOther = useCallback(
    (value: string) => {
      updateTransferField('receivingCenterOther', ['otherCenter'], value);
    },
    [updateTransferField]
  );

  const setEvacuationMethodOther = useCallback(
    (value: string) => {
      updateTransferField('evacuationMethodOther', ['otherEvacuation'], value);
    },
    [updateTransferField]
  );

  const setTransferEscortValue = useCallback(
    (value: string) => {
      updateTransferField('transferEscort', ['escort'], value);
    },
    [updateTransferField]
  );

  const handleEscortChange = useCallback(
    (value: string) => {
      if (value === 'Otro') {
        onUpdate('transferEscort', '');
      } else {
        onUpdate('transferEscort', value);
      }
      clearErrors(['escort']);
    },
    [clearErrors, onUpdate]
  );

  const handleEvacuationChange = useCallback(
    (value: string) => {
      onUpdate('evacuationMethod', value);
      const effects = resolveTransferMethodChangeEffects({ nextMethod: value });

      if (effects.nextTransferEscort) {
        onUpdate('transferEscort', effects.nextTransferEscort);
      }
      if (effects.shouldClearEvacuationMethodOther) {
        onUpdate('evacuationMethodOther', '');
      }

      clearErrors(['otherEvacuation', 'escort']);
    },
    [clearErrors, onUpdate]
  );

  const isPredefinedEscort = useMemo(
    () => isTransferEscortOption(transferEscort),
    [transferEscort]
  );

  return {
    transferDate: formState.transferDate,
    transferTime: formState.transferTime,
    movementBounds,
    errors,
    isPredefinedEscort,
    setTransferDate,
    setTransferTime,
    setReceivingCenterOther,
    setEvacuationMethodOther,
    setTransferEscortValue,
    handleEscortChange,
    handleEvacuationChange,
    submit,
  };
};
