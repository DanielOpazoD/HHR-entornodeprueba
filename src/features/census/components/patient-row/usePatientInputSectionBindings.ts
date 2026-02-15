import { useMemo } from 'react';
import { buildPatientInputSectionBindings } from '@/features/census/controllers/patientInputSectionBindingsController';
import type { PatientInputSectionBindingsParams } from '@/features/census/components/patient-row/patientInputSectionContracts';

export const usePatientInputSectionBindings = (params: PatientInputSectionBindingsParams) =>
  useMemo(
    () => buildPatientInputSectionBindings(params),
    [
      params.currentDateString,
      params.data,
      params.diagnosisMode,
      params.handleDebouncedText,
      params.hasRutError,
      params.isEmpty,
      params.isLocked,
      params.isSubRow,
      params.onChange,
      params.onDemo,
    ]
  );
