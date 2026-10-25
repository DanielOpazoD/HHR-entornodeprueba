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
] as const;

export type PatientIdentityField = (typeof PATIENT_IDENTITY_FIELDS)[number];

/**
 * A stored identity this client could not read. Only a read of a stored record sets it; it lives
 * in memory, in the device cache and in this client's backups, never in Firestore. The listed
 * fields show what a missing value shows, never a guess or a conversion of the stored one; every
 * write and every import puts `stored` back in their place.
 */
export interface PatientIdentityReview {
  /** Where it was read: the bed, or the newborn crib nested in it. */
  readonly bedId: string;
  readonly slot: 'bed' | 'clinicalCrib';
  readonly fields: readonly PatientIdentityField[];
  /** Every identity field exactly as storage holds it, before any normalization. */
  readonly stored: Readonly<Partial<Record<PatientIdentityField, unknown>>>;
}
