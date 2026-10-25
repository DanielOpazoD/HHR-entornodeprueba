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
 * fields show what a missing value shows, never a guess or a conversion of the stored one. It
 * belongs to the occupant it was read for: a write gives storage back what it held only while the
 * slot still holds that occupant, and only for a value nobody changed since the read.
 */
export interface PatientIdentityReview {
  /** Where it was read: the bed, or the newborn crib nested in it. */
  readonly bedId: string;
  readonly slot: 'bed' | 'clinicalCrib';
  /** The fields storage holds in a form this client cannot read: each waits for a repair. */
  readonly fields: readonly PatientIdentityField[];
  /** Every identity field as the read showed it: the occupant this review was read for. */
  readonly shown: Readonly<Partial<Record<PatientIdentityField, unknown>>>;
  /** Exactly as storage holds them: each listed field, and each null the read showed as empty. */
  readonly stored: Readonly<Partial<Record<PatientIdentityField, unknown>>>;
}
