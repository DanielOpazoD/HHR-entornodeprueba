import { useMemo } from 'react';
import { buildPatientInputSectionBindings } from '@/features/census/controllers/patientInputSectionBindingsController';
import type { PatientInputSectionBindingsParams } from '@/features/census/components/patient-row/patientInputSectionContracts';

export const usePatientInputSectionBindings = ({
  currentDateString,
  data,
  diagnosisMode,
  handleDebouncedText,
  hasRutError,
  isEmpty,
  isLocked,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  isNewAdmission,
  isSubRow,
  onChange,
  onDemo,
}: PatientInputSectionBindingsParams) =>
  useMemo(
    () =>
      buildPatientInputSectionBindings({
        currentDateString,
        data,
        diagnosisMode,
        handleDebouncedText,
        hasRutError,
        isEmpty,
        isLocked,
        clinicalEditingDisabled,
        clinicalFieldLocks,
        isNewAdmission,
        isSubRow,
        onChange,
        onDemo,
      }),
    [
      currentDateString,
      data,
      diagnosisMode,
      handleDebouncedText,
      hasRutError,
      isEmpty,
      isLocked,
      clinicalEditingDisabled,
      clinicalFieldLocks,
      isNewAdmission,
      isSubRow,
      onChange,
      onDemo,
    ]
  );
