import type { PatientEpisodeContract } from '@/application/patient-flow/clinicalEpisodeContracts';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';

type MovementIdentity = Pick<
  DischargeData | TransferData | CMAData,
  'patientName' | 'rut' | 'clinicalEpisodeId'
>;
type RestoredDestination = MovementIdentity &
  (Pick<DischargeData | TransferData, 'bedId'> | Pick<CMAData, 'originalBedId'>);

const normalizeIdentityValue = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? '';

const matchesRestoredPatient = (
  movement: MovementIdentity,
  patient: PatientEpisodeContract
): boolean => {
  // Compare the first available identity pair; different known episodes never collapse.
  for (const field of ['clinicalEpisodeId', 'rut', 'patientName'] as const) {
    const left = normalizeIdentityValue(movement[field]);
    const right = normalizeIdentityValue(patient[field]);
    if (left && right) return left === right;
  }
  return false;
};

export const matchesRestoredPatientDestination = (
  movement: RestoredDestination,
  bedId: string,
  patient: PatientEpisodeContract
): boolean => {
  const sourceBedId = 'bedId' in movement ? movement.bedId : movement.originalBedId;
  return sourceBedId === bedId && matchesRestoredPatient(movement, patient);
};
