import { useCallback, useMemo } from 'react';
import type { PatientData } from '@/types';
import { useDailyRecordStability } from '@/context/DailyRecordContext';
import type {
  DebouncedTextHandler,
  EventTextHandler,
} from '@/features/census/components/patient-row/inputCellTypes';
import {
  resolvePatientInputCellsLock,
  resolvePatientRutValidationError,
} from '@/features/census/controllers/patientInputCellsController';
import { dispatchTextChangeValue } from '@/features/census/controllers/textChangeAdapterController';

interface UsePatientInputCellsModelParams {
  data: PatientData;
  readOnly: boolean;
  textChange: EventTextHandler;
}

interface UsePatientInputCellsModelResult {
  isLocked: boolean;
  hasRutError: boolean;
  handleDebouncedText: DebouncedTextHandler;
}

export const usePatientInputCellsModel = ({
  data,
  readOnly,
  textChange,
}: UsePatientInputCellsModelParams): UsePatientInputCellsModelResult => {
  const stabilityRules = useDailyRecordStability();

  const isLocked = useMemo(
    () =>
      resolvePatientInputCellsLock({
        readOnly,
        canEditField: stabilityRules?.canEditField,
      }),
    [readOnly, stabilityRules]
  );

  const hasRutError = useMemo(
    () =>
      resolvePatientRutValidationError({
        documentType: data.documentType,
        rut: data.rut,
      }),
    [data.documentType, data.rut]
  );

  const handleDebouncedText = useCallback<DebouncedTextHandler>(
    (field: keyof PatientData) => (value: string) => {
      dispatchTextChangeValue(textChange, field, value);
    },
    [textChange]
  );

  return {
    isLocked,
    hasRutError,
    handleDebouncedText,
  };
};
