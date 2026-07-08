import { useMemo } from 'react';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { usePatientRowRuntime } from './usePatientRowRuntime';
import {
  buildPatientRowBindings,
  type PatientRowBindingsInput,
} from '../../controllers/patientRowBindingsController';

interface UsePatientRowBindingsModelParams extends PatientRowBindingsInput {
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export const usePatientRowBindingsModel = ({
  bed,
  data,
  currentDateString,
  onAction,
  readOnly,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  actionMenuAlign,
  diagnosisMode,
  isSubRow,
  role,
  accessProfile,
  indicators,
  bedType,
  style,
}: UsePatientRowBindingsModelParams) => {
  const runtime = usePatientRowRuntime({ bed, data, currentDateString, onAction });

  return useMemo(
    () =>
      buildPatientRowBindings({
        bed,
        bedType,
        data,
        currentDateString,
        readOnly,
        clinicalEditingDisabled,
        clinicalFieldLocks,
        actionMenuAlign,
        diagnosisMode,
        isSubRow,
        role,
        accessProfile,
        indicators,
        style,
        runtime,
      }),
    [
      actionMenuAlign,
      bed,
      bedType,
      currentDateString,
      data,
      diagnosisMode,
      indicators,
      isSubRow,
      role,
      accessProfile,
      readOnly,
      clinicalEditingDisabled,
      clinicalFieldLocks,
      runtime,
      style,
    ]
  );
};
