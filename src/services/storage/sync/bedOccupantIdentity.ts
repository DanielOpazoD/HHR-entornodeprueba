import type { PatientData } from '@/types/domain/patient';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';

const hasIdentity = (patient: PatientData | undefined): boolean =>
  Boolean(
    patient &&
    [patient.clinicalEpisodeId, patient.rut, patient.patientName].some(value =>
      String(value ?? '').trim()
    )
  );

const documentOf = (patient: PatientData): string =>
  `${patient.documentType ?? 'RUT'}:${String(patient.rut ?? '')
    .trim()
    .toUpperCase()}`;

/** Both slots empty, or the same patient and episode. A RUT never matches a passport. */
export const hasSameBedOccupant = (
  left: PatientData | undefined,
  right: PatientData | undefined
): boolean => {
  if (!hasIdentity(left) && !hasIdentity(right)) return true;
  return Boolean(
    left &&
    right &&
    hasIdentity(left) &&
    hasIdentity(right) &&
    hasSamePatientEpisodeIdentity(left, right) &&
    documentOf(left) === documentOf(right)
  );
};
