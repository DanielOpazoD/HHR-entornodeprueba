import type { PatientData } from './patient';

export type PatientIdentityStatus = 'provisional' | 'official';

/** The fields that say who a patient is and which admission this is. */
export const PATIENT_IDENTITY_FIELDS = [
  'documentType',
  'rut',
  'clinicalEpisodeId',
  'identityStatus',
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'admissionDate',
  'admissionTime',
] as const satisfies readonly (keyof PatientData)[];

export type PatientIdentityField = (typeof PATIENT_IDENTITY_FIELDS)[number];

/**
 * A stored identity this client could not read. Only a read of a stored record sets it; it lives
 * in memory and in the device cache, never in Firestore. The listed fields hold the stored value
 * as text, or nothing, never a guess, so a write may change them only one field at a time.
 */
export interface PatientIdentityReview {
  /** Where it was read: the bed, or the newborn crib nested in it. */
  readonly bedId: string;
  readonly slot: 'bed' | 'clinicalCrib';
  readonly fields: readonly [PatientIdentityField, ...PatientIdentityField[]];
}
