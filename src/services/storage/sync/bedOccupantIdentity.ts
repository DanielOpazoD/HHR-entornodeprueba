import type { PatientData } from '@/types/domain/patient';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';
import { isSameIdentityUnderReview } from '@/shared/census/patientIdentityReview';

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

/**
 * Both slots empty, or the same patient and episode. A RUT never matches a passport. An identity
 * under review shows placeholders, so its own rule decides: that identity, or its readable episode.
 */
export const hasSameBedOccupant = (
  left: PatientData | undefined,
  right: PatientData | undefined
): boolean => {
  const reviewed = left && right && isSameIdentityUnderReview(left, right);
  if (reviewed !== undefined) return reviewed;
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
