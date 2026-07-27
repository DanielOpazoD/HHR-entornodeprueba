import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';

export interface ClinicalFillCandidate {
  bedId: string;
  patient: PatientData;
  clinicalCrib: boolean;
}

const isEligible = (patient: PatientData | undefined): patient is PatientData =>
  !!patient?.clinicalEpisodeId && !!patient.patientName?.trim();

export const collectClinicalFillCandidates = (record: DailyRecord): ClinicalFillCandidate[] =>
  Object.entries(record.beds).flatMap(([bedId, patient]) => {
    const candidates: ClinicalFillCandidate[] = [];
    if (isEligible(patient)) candidates.push({ bedId, patient, clinicalCrib: false });
    if (isEligible(patient?.clinicalCrib)) {
      candidates.push({ bedId, patient: patient.clinicalCrib, clinicalCrib: true });
    }
    return candidates;
  });

export const countClinicalFillEligiblePatients = (record: DailyRecord): number =>
  collectClinicalFillCandidates(record).length;
