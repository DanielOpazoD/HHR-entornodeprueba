import type { PatientData } from '@/types/domain/patient';

const hasMeaningfulIdentityValue = (value?: string): boolean => Boolean(value?.trim());

export const hasDisplayablePatientName = (
  patient: Pick<PatientData, 'patientName'> | null | undefined
): boolean => hasMeaningfulIdentityValue(patient?.patientName);

export const shouldAnchorFirstSeenDate = ({
  currentPatientName,
  currentRut,
  nextPatientName,
  nextRut,
}: {
  currentPatientName?: string;
  currentRut?: string;
  nextPatientName?: string;
  nextRut?: string;
  currentFirstSeenDate?: string;
}): boolean => {
  const hadIdentity =
    hasMeaningfulIdentityValue(currentPatientName) || hasMeaningfulIdentityValue(currentRut);
  const hasIdentityNow =
    hasMeaningfulIdentityValue(nextPatientName) || hasMeaningfulIdentityValue(nextRut);

  // Empty identity means a new episode, even if a remote partial clear left a stale anchor behind.
  return !hadIdentity && hasIdentityNow;
};
