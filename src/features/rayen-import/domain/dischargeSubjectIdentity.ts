import type { DischargeEntry } from '../contracts/censusImportDiff';
import type { PatientData } from '../contracts/rayenDomainContracts';
import {
  normalizeOfficialPatientIdentifier,
  officialPatientIdentifiersEqual,
} from './officialPatientIdentifier';

/**
 * Ocupante manual (sin episodio) cuya identidad SÍ podrá verificarse al aplicar:
 * la misma regla que `matchesDischargeSubject` exige (RUN y sello de ingreso).
 * La planificación no debe prometer sobre un egreso que el apply rechazará.
 */
export const isVerifiableLegacyOccupant = (entry: DischargeEntry): boolean => {
  const expected = entry.expectedOccupant;
  const entryEpisode = String(entry.encounterId ?? entry.source?.encounterId ?? '').trim();
  return Boolean(
    expected &&
    !entryEpisode &&
    !String(expected.clinicalEpisodeId ?? '').trim() &&
    normalizeOfficialPatientIdentifier(expected.rut) &&
    expected.admissionDate &&
    expected.admissionTime
  );
};

export const matchesDischargeSubject = (patient: PatientData, entry: DischargeEntry): boolean => {
  const expected = entry.expectedOccupant;
  if (expected) {
    if (expected.clinicalEpisodeId) {
      return patient.clinicalEpisodeId === expected.clinicalEpisodeId;
    }
    const patientRun = normalizeOfficialPatientIdentifier(patient.rut);
    const expectedRun = normalizeOfficialPatientIdentifier(expected.rut);
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
  return officialPatientIdentifiersEqual(patient.rut, entry.rut);
};
