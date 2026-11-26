import { isCalendarDate } from '@/utils/clinicalDateUtils';
import type { PatientData } from '@/types/domain/patient';

const documentKey = (patient: PatientData): string =>
  String(patient.rut || '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();

/** Clinical evidence needs a stable episode owner; a bed or a matching name is insufficient. */
export const canCarryClinicalEvidence = (
  source: PatientData,
  destination: PatientData,
  sourceDate: string,
  destinationDate: string
): boolean => {
  if (!source || !destination) return false;
  const episode = source.clinicalEpisodeId?.trim();
  const admissionDate = source.admissionDate;
  return Boolean(
    isCalendarDate(sourceDate) &&
    isCalendarDate(destinationDate) &&
    Date.parse(`${destinationDate}T00:00:00Z`) - Date.parse(`${sourceDate}T00:00:00Z`) ===
      86_400_000 &&
    isCalendarDate(admissionDate) &&
    admissionDate <= sourceDate &&
    episode &&
    episode === destination.clinicalEpisodeId?.trim() &&
    documentKey(source) &&
    documentKey(source) === documentKey(destination) &&
    (source.documentType || 'RUT') === (destination.documentType || 'RUT') &&
    admissionDate === destination.admissionDate &&
    (source.admissionTime || '') === (destination.admissionTime || '')
  );
};
