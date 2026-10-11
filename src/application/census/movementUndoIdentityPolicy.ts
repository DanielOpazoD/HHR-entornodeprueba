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
  const movementEpisodeId = normalizeIdentityValue(movement.clinicalEpisodeId);
  const restoredEpisodeId = normalizeIdentityValue(patient.clinicalEpisodeId);
  if (movementEpisodeId && restoredEpisodeId) {
    return movementEpisodeId === restoredEpisodeId;
  }

  const movementRut = normalizeIdentityValue(movement.rut);
  const restoredRut = normalizeIdentityValue(patient.rut);
  if (movementRut && restoredRut) {
    return movementRut === restoredRut;
  }

  const movementName = normalizeIdentityValue(movement.patientName);
  const restoredName = normalizeIdentityValue(patient.patientName);
  return Boolean(movementName && restoredName && movementName === restoredName);
};

export const matchesRestoredPatientDestination = (
  movement: RestoredDestination,
  bedId: string,
  patient: PatientEpisodeContract
): boolean => {
  const sourceBedId = 'bedId' in movement ? movement.bedId : movement.originalBedId;
  return sourceBedId === bedId && matchesRestoredPatient(movement, patient);
};
