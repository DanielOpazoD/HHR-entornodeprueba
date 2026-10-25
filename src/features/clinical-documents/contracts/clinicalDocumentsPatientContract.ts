import type { PatientEpisodeContract } from '@/application/patient-flow/clinicalEpisodeContracts';
import type { PatientIdentityReview } from '@/types/domain/patientIdentity';

export type ClinicalDocumentsEpisodeClosureKind = 'discharge' | 'transfer';

export interface ClinicalDocumentsWorkspacePatientContract extends PatientEpisodeContract {
  patientName?: string;
  rut?: string;
  age?: string;
  birthDate?: string;
  admissionDate?: string;
  episodeClosureKind?: ClinicalDocumentsEpisodeClosureKind;
  episodeClosureDate?: string;
  dischargeDate?: string;
  transferDate?: string;
  identityReview?: PatientIdentityReview;
}

export type PatientData = ClinicalDocumentsWorkspacePatientContract;
