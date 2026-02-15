import type {
  PatientInputSectionBindings,
  PatientInputSectionSharedProps,
  PatientInputSectionBindingsParams,
} from '@/features/census/components/patient-row/patientInputSectionContracts';

const buildPatientInputSectionSharedProps = ({
  data,
  currentDateString,
  isSubRow,
  isEmpty,
  isLocked,
}: Pick<
  PatientInputSectionBindingsParams,
  'data' | 'currentDateString' | 'isSubRow' | 'isEmpty' | 'isLocked'
>): PatientInputSectionSharedProps => ({
  data,
  currentDateString,
  isSubRow,
  isEmpty,
  isLocked,
});

export const buildPatientInputSectionBindings = ({
  data,
  currentDateString,
  isSubRow,
  isEmpty,
  isLocked,
  diagnosisMode,
  hasRutError,
  handleDebouncedText,
  onDemo,
  onChange,
}: PatientInputSectionBindingsParams): PatientInputSectionBindings => {
  const shared = buildPatientInputSectionSharedProps({
    data,
    currentDateString,
    isSubRow,
    isEmpty,
    isLocked,
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
