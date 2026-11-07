import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import { isValidRut } from '@/utils/rutUtils';
import { canExploreClinicalPatient } from '@/features/census/controllers/clinicalExplorerController';

/** The patient topics the turtle menu can open, each read from the patient's own identifiers. */
export interface PatientClinicalTopics {
  clinicalPanel: boolean;
  laboratory: boolean;
  imaging: boolean;
  clinicalExplorer: boolean;
}

const NO_CLINICAL_TOPICS: PatientClinicalTopics = {
  clinicalPanel: false,
  laboratory: false,
  imaging: false,
  clinicalExplorer: false,
};

// Syslab and MMRAD search by Chilean RUT; a passport is never compared as one.
const hasChileanRut = (patient: PatientData): boolean => {
  const rut = patient.rut.trim();
  return Boolean(rut && rut !== '-' && patient.documentType !== 'Pasaporte');
};

export const resolvePatientClinicalTopics = (patient?: PatientData): PatientClinicalTopics => {
  if (!patient?.patientName.trim()) return NO_CLINICAL_TOPICS;
  const episode = Boolean(patient.clinicalEpisodeId?.trim());
  return {
    // The panel and the laboratory search are fetched by Eloísa episode.
    clinicalPanel: episode,
    laboratory: episode && hasChileanRut(patient),
    imaging: hasChileanRut(patient) && isValidRut(patient.rut.trim()),
    clinicalExplorer: canExploreClinicalPatient(patient),
  };
};
