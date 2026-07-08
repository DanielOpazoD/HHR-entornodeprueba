import type {
  PatientInputSectionBindings,
  PatientInputSectionSharedProps,
  PatientInputSectionBindingsParams,
} from '@/features/census/components/patient-row/patientInputSectionContracts';

const buildPatientInputSectionSharedProps = ({
  data,
  currentDateString,
  isNewAdmission,
  isSubRow,
  isEmpty,
  isLocked,
  clinicalEditingDisabled,
  clinicalFieldLocks,
}: Pick<
  PatientInputSectionBindingsParams,
  | 'data'
  | 'currentDateString'
  | 'isNewAdmission'
  | 'isSubRow'
  | 'isEmpty'
  | 'isLocked'
  | 'clinicalEditingDisabled'
  | 'clinicalFieldLocks'
>): PatientInputSectionSharedProps => ({
  data,
  currentDateString,
  isNewAdmission,
  isSubRow,
  isEmpty,
  isLocked,
  clinicalEditingDisabled,
  clinicalFieldLocks,
});

export const buildPatientInputSectionBindings = ({
  data,
  currentDateString,
  isNewAdmission,
  isSubRow,
  isEmpty,
  isLocked,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  diagnosisMode,
  hasRutError,
  handleDebouncedText,
  onDemo,
  onChange,
}: PatientInputSectionBindingsParams): PatientInputSectionBindings => {
  const shared = buildPatientInputSectionSharedProps({
    data,
    currentDateString,
    isNewAdmission,
    isSubRow,
    isEmpty,
    isLocked,
    clinicalEditingDisabled,
    clinicalFieldLocks,
  });

  return {
    identity: {
      shared,
      hasRutError,
      handleDebouncedText,
      onDemo,
      onChange,
    },
    clinical: {
      shared,
      diagnosisMode,
      handleDebouncedText,
      onChange,
    },
    flow: {
      shared,
      handleDebouncedText,
      onChange,
    },
    flags: {
      shared,
      onChange,
    },
  } satisfies PatientInputSectionBindings;
};
