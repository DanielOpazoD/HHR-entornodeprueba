import type { PatientEpisodeContract } from '@/domain/clinical-episode/clinicalEpisodeContracts';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';

type MovementIdentity = Pick<
  DischargeData | TransferData | CMAData,
  'patientName' | 'rut' | 'clinicalEpisodeId'
>;
type RestoredDestination = MovementIdentity &
  (Pick<DischargeData | TransferData, 'bedId' | 'isNested'> | Pick<CMAData, 'originalBedId'>);
type RestoredBed = PatientEpisodeContract & { clinicalCrib?: PatientEpisodeContract };

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

/**
 * Whether restoring `bed` brings back the person a movement row took out of it. Mother and newborn
 * are distinct people (ID-03): a crib row is compared with the restored crib, never with the
 * mother, even when an old record gave both her document and the same derived episode.
 */
export const matchesRestoredPatientDestination = (
  movement: RestoredDestination,
  bedId: string,
  bed: RestoredBed
): boolean => {
  const sourceBedId = 'bedId' in movement ? movement.bedId : movement.originalBedId;
  const restoredPerson = 'isNested' in movement && movement.isNested ? bed.clinicalCrib : bed;
  return (
    sourceBedId === bedId && !!restoredPerson && matchesRestoredPatient(movement, restoredPerson)
  );
};
