import type { PatientData } from '@/types/domain/patient';
import { normalizeRut } from '@/utils/rutUtils';

const unprovenPatientKeys = new WeakMap<PatientData, string>();
let unprovenPatientCount = 0;

/**
 * Who a laboratory request belongs to: the episode, or else the document and admission. The bed
 * is only a place, so a new patient in the same bed starts a blank request. Without episode or
 * document nothing proves it is the same person, so every new patient record starts blank. Kept
 * apart from the form model so the census rows can name a patient without loading the form.
 */
export const resolveExamRequestPatientIdentity = (patient: PatientData): string => {
  if (patient.clinicalEpisodeId) return `episode:${patient.clinicalEpisodeId}`;
  const document = resolveDocument(patient);
  if (document) {
    return [patient.documentType ?? 'RUT', document, patient.admissionDate ?? ''].join(':');
  }
  let unprovenKey = unprovenPatientKeys.get(patient);
  if (!unprovenKey) {
    unprovenPatientCount += 1;
    unprovenKey = `unproven:${unprovenPatientCount}`;
    unprovenPatientKeys.set(patient, unprovenKey);
  }
  return unprovenKey;
};

/**
 * Whether an episode or a document tells this patient apart. Without both, only the name does, and
 * two newborns with the same name could pass for one: such a patient never joins a request for
 * several patients, whose tabs must stay with the same person across census updates.
 */
export const hasExamRequestRecordIdentity = (patient: PatientData): boolean =>
  Boolean(patient.clinicalEpisodeId || resolveDocument(patient));

const resolveDocument = (patient: PatientData): string => {
  const rut = (patient.rut ?? '').trim();
  if (rut === '-') return '';
  // A passport is never read as a RUT.
  return (patient.documentType ?? 'RUT') === 'RUT' ? normalizeRut(rut) : rut.toUpperCase();
};
