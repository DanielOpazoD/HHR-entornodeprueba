import { buildClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';

export interface ClinicalDocumentValidationIssue {
  path: string;
  message: string;
}

export interface ClinicalDocumentEpisodeContext {
  patientRut: string;
  patientName: string;
  episodeKey: string;
  documentLookupEpisodeKeys?: string[];
  admissionDate?: string;
  admissionTime?: string;
  sourceDailyRecordDate?: string;
  sourceBedId?: string;
  specialty?: string;
}

/**
 * Canonical hospitalization-episode key. Used to group every clinical
 * document of a single hospitalization (admission → discharge), regardless
 * of how many documents the team produces during the stay.
 *
 * Format: `RUT__admissionDate` (e.g., `"8.258.248-7__2026-03-17"`). RUT
 * preserves its source format (with dots/dashes); the admission date is
 * an ISO-style YYYY-MM-DD string. Returns `null` when either field is
 * missing or empty — callers should treat that as "no episode to lock".
 */
export const buildClinicalDocumentEpisodeKey = (
  patientRut: string | undefined | null,
  admissionDate: string | undefined | null
): string | null => {
  const rut = (patientRut ?? '').trim();
  const date = (admissionDate ?? '').trim();
  if (!rut || !date) return null;
  return buildClinicalEpisodeKey(rut, date);
};
