import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';

export interface ClinicalFillCandidate {
  bedId: string;
  patient: PatientData;
  clinicalCrib: boolean;
}

type EligibleClinicalPatient = PatientData & {
  clinicalEpisodeId: string;
  patientName: string;
};

const isEligible = (patient: PatientData | undefined): patient is EligibleClinicalPatient =>
  !!patient?.clinicalEpisodeId && !!patient.patientName?.trim();

export const collectClinicalFillCandidates = (
  record: DailyRecord,
  allowedClinicalEpisodeIds?: readonly string[]
): ClinicalFillCandidate[] => {
  const allowed = allowedClinicalEpisodeIds ? new Set(allowedClinicalEpisodeIds) : null;
  return Object.entries(record.beds).flatMap(([bedId, patient]) => {
    const candidates: ClinicalFillCandidate[] = [];
    if (isEligible(patient) && (!allowed || allowed.has(patient.clinicalEpisodeId))) {
      candidates.push({ bedId, patient, clinicalCrib: false });
    }
    if (
      isEligible(patient?.clinicalCrib) &&
      (!allowed || allowed.has(patient.clinicalCrib.clinicalEpisodeId))
    ) {
      candidates.push({ bedId, patient: patient.clinicalCrib, clinicalCrib: true });
    }
    return candidates;
  });
};

export const countClinicalFillEligiblePatients = (
  record: DailyRecord,
  allowedClinicalEpisodeIds?: readonly string[]
): number => collectClinicalFillCandidates(record, allowedClinicalEpisodeIds).length;
