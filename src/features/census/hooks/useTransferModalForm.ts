import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvacuationMethod, ReceivingCenter } from '@/constants';
import { isTransferEscortOption } from '@/constants';
import {
  buildTransferValidationErrors,
  resolveTransferInitialMovementDate,
  resolveTransferInitialTime,
  resolveTransferMethodChangeEffects,
  type TransferModalFieldErrors,
} from '@/features/census/controllers/transferModalController';
import { resolveMovementDateTimeBounds } from '@/features/census/controllers/clinicalShiftCalendarController';
import {
  clearModalFieldErrors,
  submitModalForm,
} from '@/features/census/controllers/modalFormController';
import { useLatestRef } from '@/hooks/useLatestRef';
import type { TransferUpdateField } from '@/features/census/types/censusActionModalContracts';

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
  onUpdate: (field: TransferUpdateField, value: string) => void;
  onConfirm: (data: { time: string; movementDate?: string }) => void;
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
  onUpdate,
  onConfirm,
  resolveDefaultTime,
}: UseTransferModalFormParams): UseTransferModalFormResult => {
  const resolveDefaultTimeRef = useLatestRef(resolveDefaultTime);
  const [transferDate, setTransferDateState] = useState('');
  const [transferTime, setTransferTimeState] = useState('');
  const [errors, setErrors] = useState<TransferModalFieldErrors>({});
  const movementBounds = resolveMovementDateTimeBounds(recordDate);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTransferDateState(
      resolveTransferInitialMovementDate(recordDate, initialMovementDate, initialTime)
    );
    setTransferTimeState(resolveTransferInitialTime(initialTime, resolveDefaultTimeRef.current()));
    setErrors({});
  }, [initialMovementDate, initialTime, isOpen, recordDate, resolveDefaultTimeRef]);

  const setTransferDate = useCallback((nextDate: string) => {
    setTransferDateState(nextDate);
    setErrors(prev => clearModalFieldErrors(prev, ['dateTime']));
  }, []);

  const setTransferTime = useCallback((nextTime: string) => {
    setTransferTimeState(nextTime);
    setErrors(prev => clearModalFieldErrors(prev, ['time', 'dateTime']));
  }, []);

  const setReceivingCenterOther = useCallback(
    (value: string) => {
      onUpdate('receivingCenterOther', value);
      setErrors(prev => clearModalFieldErrors(prev, ['otherCenter']));
    },
    [onUpdate]
  );

  const setEvacuationMethodOther = useCallback(
    (value: string) => {
      onUpdate('evacuationMethodOther', value);
      setErrors(prev => clearModalFieldErrors(prev, ['otherEvacuation']));
    },
    [onUpdate]
  );

  const setTransferEscortValue = useCallback(
    (value: string) => {
      onUpdate('transferEscort', value);
      setErrors(prev => clearModalFieldErrors(prev, ['escort']));
    },
    [onUpdate]
  );

  const handleEscortChange = useCallback(
    (value: string) => {
      if (value === 'Otro') {
        onUpdate('transferEscort', '');
      } else {
        onUpdate('transferEscort', value);
      }
      setErrors(prev => clearModalFieldErrors(prev, ['escort']));
    },
    [onUpdate]
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

      setErrors(prev => clearModalFieldErrors(prev, ['otherEvacuation', 'escort']));
    },
    [onUpdate]
  );

  const submit = useCallback((): boolean => {
    return submitModalForm({
      state: {
        recordDate,
        includeMovementDate,
        transferDate,
        evacuationMethod,
        evacuationMethodOther,
        receivingCenter,
        receivingCenterOther,
        transferEscort,
        transferTime,
      },
      validate: state =>
        buildTransferValidationErrors({
          recordDate: state.recordDate,
          movementDate: state.includeMovementDate ? state.transferDate : '',
          evacuationMethod: state.evacuationMethod,
          evacuationMethodOther: state.evacuationMethodOther,
          receivingCenter: state.receivingCenter,
          receivingCenterOther: state.receivingCenterOther,
          transferEscort: state.transferEscort,
          transferTime: state.transferTime,
        }),
      buildPayload: state => ({
        time: state.transferTime,
        movementDate: state.includeMovementDate ? state.transferDate : undefined,
      }),
      onValidationErrors: setErrors,
      onConfirm,
    });
  }, [
    evacuationMethod,
    evacuationMethodOther,
    includeMovementDate,
    onConfirm,
    recordDate,
    receivingCenter,
    receivingCenterOther,
    transferDate,
    transferEscort,
    transferTime,
  ]);

  const isPredefinedEscort = useMemo(
    () => isTransferEscortOption(transferEscort),
    [transferEscort]
  );

  return {
    transferDate,
    transferTime,
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
