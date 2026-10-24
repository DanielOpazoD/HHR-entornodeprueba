import type { PatientData } from '@/types/domain/patient';

const documentKey = (patient: PatientData): string =>
  String(patient.rut || '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();

const isIsoDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
};

/** Clinical evidence needs a stable episode owner; a bed or a matching name is insufficient. */
export const canCarryClinicalEvidence = (
  source: PatientData,
  destination: PatientData,
  sourceDate: string,
  destinationDate: string
): boolean => {
  const episode = source.clinicalEpisodeId?.trim();
  const admissionDate = source.admissionDate;
  return Boolean(
    !source.identityReview &&
    !destination.identityReview &&
    isIsoDay(sourceDate) &&
    isIsoDay(destinationDate) &&
    Date.parse(`${destinationDate}T00:00:00Z`) - Date.parse(`${sourceDate}T00:00:00Z`) ===
      86_400_000 &&
    isIsoDay(admissionDate) &&
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
