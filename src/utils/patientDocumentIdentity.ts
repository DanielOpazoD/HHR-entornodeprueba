import type { PatientData } from '@/types/domain/patient';
import { hasNonRutLetter, normalizeRut } from '@/utils/rutUtils';

const hasIdentityText = (value?: string): boolean => Boolean(value?.trim());

const normalizeDocumentForComparison = (
  value?: string,
  documentType?: PatientData['documentType']
): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (documentType === 'Pasaporte' || hasNonRutLetter(trimmed)) {
    return trimmed;
  }
  return /^\d[\d.\s-]*[\dkK]$/.test(trimmed) ? normalizeRut(trimmed) : trimmed;
};

/**
 * True when a manual update on an already-occupied patient substantively edits the stored
 * document (changing RUT <-> Pasaporte, editing a passport string, or changing the RUT
 * beyond punctuation formatting). Empty-bed admissions and unchanged Demographics resends
 * return false so source repairs remain active unless a person intentionally corrected it.
 */
export const editsPatientDocumentIdentity = (
  current: Partial<PatientData> | undefined,
  updates: Partial<PatientData>
): boolean => {
  if (!current) return false;
  const hadIdentity = hasIdentityText(current.patientName) || hasIdentityText(current.rut);
  if (!hadIdentity) return false;

  if (
    current.clinicalEpisodeId &&
    updates.clinicalEpisodeId &&
    current.clinicalEpisodeId !== updates.clinicalEpisodeId
  ) {
    return false;
  }

  const currentType = current.documentType || 'RUT';
  const hasDocumentTypeUpdate =
    Object.prototype.hasOwnProperty.call(updates, 'documentType') &&
    updates.documentType !== undefined;
  const nextType = hasDocumentTypeUpdate ? updates.documentType || 'RUT' : currentType;
  if (nextType !== currentType) {
    return true;
  }

  if (!Object.prototype.hasOwnProperty.call(updates, 'rut') || typeof updates.rut !== 'string') {
    return false;
  }

  const currentNormalized = normalizeDocumentForComparison(current.rut, currentType);
  const nextNormalized = normalizeDocumentForComparison(updates.rut, nextType);
  return currentNormalized !== nextNormalized;
};
