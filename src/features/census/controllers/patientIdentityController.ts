import type { PatientIdentityReview } from '@/types/domain/patientIdentity';

export interface PatientIdentitySnapshot {
  patientName?: string | null;
  rut?: string | null;
  identityReview?: PatientIdentityReview;
}

/** A bed whose stored identity could not be read is occupied, even when no name could be shown. */
export const hasMeaningfulPatientIdentity = (data: PatientIdentitySnapshot | null | undefined) =>
  Boolean(data?.patientName?.trim() || data?.rut?.trim() || data?.identityReview);
