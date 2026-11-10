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
}: Pick<
  PatientInputSectionBindingsParams,
  | 'data'
  | 'currentDateString'
  | 'isNewAdmission'
  | 'isSubRow'
  | 'isEmpty'
  | 'isLocked'
  | 'clinicalEditingDisabled'
>): PatientInputSectionSharedProps => ({
  data,
  currentDateString,
  isNewAdmission,
  isSubRow,
  isEmpty,
  isLocked,
  clinicalEditingDisabled,
});

export const buildPatientInputSectionBindings = ({
  data,
  currentDateString,
  isNewAdmission,
  isSubRow,
  isEmpty,
  isLocked,
  clinicalEditingDisabled,
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
