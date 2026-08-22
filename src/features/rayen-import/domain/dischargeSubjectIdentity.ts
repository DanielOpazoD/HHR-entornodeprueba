import type { DischargeEntry } from '../contracts/censusImportDiff';
import type { PatientData } from '../contracts/rayenDomainContracts';
import { normalizeRut } from '@/utils/rutUtils';

export const matchesDischargeSubject = (patient: PatientData, entry: DischargeEntry): boolean => {
  const expected = entry.expectedOccupant;
  if (expected) {
    if (expected.clinicalEpisodeId) {
      return patient.clinicalEpisodeId === expected.clinicalEpisodeId;
    }
    const patientRun = normalizeRut(patient.rut);
    const expectedRun = normalizeRut(expected.rut);
    return Boolean(
      expected.admissionDate &&
      expected.admissionTime &&
      patientRun &&
      expectedRun &&
      patientRun === expectedRun &&
      patient.admissionDate === expected.admissionDate &&
      patient.admissionTime === expected.admissionTime
    );
  }
  const entryEpisode = entry.encounterId ?? entry.source?.encounterId;
  if (patient.clinicalEpisodeId || entryEpisode) {
    return Boolean(
      patient.clinicalEpisodeId && entryEpisode && patient.clinicalEpisodeId === entryEpisode
    );
  }
  const patientRun = normalizeRut(patient.rut);
  const entryRun = normalizeRut(entry.rut);
  return Boolean(patientRun && entryRun && patientRun === entryRun);
};
