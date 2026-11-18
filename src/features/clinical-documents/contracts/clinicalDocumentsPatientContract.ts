import type { PatientEpisodeContract } from '@/domain/clinical-episode/clinicalEpisodeContracts';

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
}
