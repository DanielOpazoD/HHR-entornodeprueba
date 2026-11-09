import type { PatientData } from '@/types/domain/patient';
import { normalizeRut } from '@/utils/rutUtils';

const unprovenPatientKeys = new WeakMap<PatientData, string>();
let unprovenPatientCount = 0;

/**
 * Who a laboratory request belongs to: the episode, or else the document and the admission's day
 * and time, which tell two stays of one person apart. The bed is only a place, so a new patient in
 * the same bed starts a blank request. When nothing proves the person and the stay, every new
 * patient record starts blank. Kept apart from the form model so the census rows can name a
 * patient without loading the form.
 */
export const resolveExamRequestPatientIdentity = (patient: PatientData): string => {
  if (patient.clinicalEpisodeId) return `episode:${patient.clinicalEpisodeId}`;
  const stay = resolveDocumentedStay(patient);
  if (stay) return stay;
  let unprovenKey = unprovenPatientKeys.get(patient);
  if (!unprovenKey) {
    unprovenPatientCount += 1;
    unprovenKey = `unproven:${unprovenPatientCount}`;
    unprovenPatientKeys.set(patient, unprovenKey);
  }
  return unprovenKey;
};

/**
 * Whether the episode, or the document with the admission's day and time, proves this patient and
 * stay. Without that, two newborns with one name or two stays on one day could pass for one: such
 * a patient never joins a request for several patients, whose tabs must stay with the same person
 * and stay across census updates.
 */
export const hasExamRequestRecordIdentity = (patient: PatientData): boolean =>
  Boolean(patient.clinicalEpisodeId || resolveDocumentedStay(patient));

/** Document, admission day and admission time; empty when any of them is missing. */
const resolveDocumentedStay = (patient: PatientData): string => {
  const document = resolveDocument(patient);
  const admissionDate = (patient.admissionDate ?? '').trim();
  const admissionTime = (patient.admissionTime ?? '').trim();
  if (!document || !admissionDate || !admissionTime) return '';
  return [patient.documentType ?? 'RUT', document, `${admissionDate}T${admissionTime}`].join(':');
};

const resolveDocument = (patient: PatientData): string => {
  const rut = (patient.rut ?? '').trim();
  if (rut === '-') return '';
  // A passport is never read as a RUT.
  return (patient.documentType ?? 'RUT') === 'RUT' ? normalizeRut(rut) : rut.toUpperCase();
};
