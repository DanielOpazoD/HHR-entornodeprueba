import type { ClinicalDocumentEpisodeContext } from '@/features/clinical-documents/domain/entities';
import type { PatientData } from '@/features/clinical-documents/contracts/clinicalDocumentsPatientContract';
import {
  buildClinicalEpisodeKey as buildClinicalEpisodeKeyFromApplication,
  buildClinicalEpisodeLookupKeys,
  type ClinicalEpisodeFallbackEvent,
  resolveClinicalEpisode,
  resolveClinicalEpisodeAdmissionDate,
} from '@/application/patient-flow/clinicalEpisode';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { calculateAge } from '@/utils/clinicalUtils';
import { normalizeCalendarDate } from '@/utils/clinicalDateUtils';

/**
 * Builds a composite key that uniquely identifies a clinical episode.
 * @param patientRut - Patient national identifier (RUT)
 * @param admissionDate - Optional admission date to disambiguate episodes
 * @returns Deterministic episode key string
 */
export const buildClinicalEpisodeKey = (
  patientRut: string,
  admissionDate?: string,
  admissionTime?: string
): string => buildClinicalEpisodeKeyFromApplication(patientRut, admissionDate, admissionTime);

const padTime = (value: number): string => value.toString().padStart(2, '0');

/** Returns today's date as an ISO date string (YYYY-MM-DD). */
export const getCurrentDateValue = (): string => new Date().toISOString().slice(0, 10);

/** Returns the current local time as an HH:MM string. */
export const getCurrentTimeValue = (): string => {
  const date = new Date();
  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
};

const resolveClinicalDocumentDischargeDateValue = (patient: PatientData): string =>
  normalizeCalendarDate(patient.episodeClosureDate) ||
  normalizeCalendarDate(patient.dischargeDate) ||
  normalizeCalendarDate(patient.transferDate) ||
  getCurrentDateValue();

export const buildClinicalDocumentEpisodeLookupKeys = (
  patient: PatientData,
  primaryEpisodeKey?: string
): string[] => buildClinicalEpisodeLookupKeys(patient, primaryEpisodeKey);

const recordClinicalDocumentEpisodeFallback = (
  event: ClinicalEpisodeFallbackEvent,
  context: { sourceDailyRecordDate: string; sourceBedId: string }
): void => {
  recordOperationalTelemetry({
    category: 'clinical_document',
    operation: 'clinical_episode_key_fallback',
    status: 'degraded',
    runtimeState: 'degraded',
    date: context.sourceDailyRecordDate,
    issues: ['Clinical document episode resolved without clinicalEpisodeId.'],
    context: {
      ...event,
      sourceBedId: context.sourceBedId,
    },
  });
};

/**
 * Resolves the full episode context for a clinical document.
 * @param patient - Patient demographic and admission data
 * @param sourceDailyRecordDate - Date of the originating daily record
 * @param sourceBedId - Bed identifier from the daily record
 * @returns Episode context used to scope the document
 */
export const buildClinicalDocumentEpisodeContext = (
  patient: PatientData,
  sourceDailyRecordDate: string,
  sourceBedId: string
): ClinicalDocumentEpisodeContext => {
  const episode = resolveClinicalEpisode(
    patient,
    {
      sourceDailyRecordDate,
      sourceBedId,
    },
    {
      source: 'clinical_document',
      onFallback: event =>
        recordClinicalDocumentEpisodeFallback(event, { sourceDailyRecordDate, sourceBedId }),
    }
  );
  const lookupKeys = buildClinicalDocumentEpisodeLookupKeys(patient, episode.episodeKey);
  const documentLookupEpisodeKeys = lookupKeys.filter(key => key !== episode.episodeKey);

  return {
    ...episode,
    ...(documentLookupEpisodeKeys.length > 0 ? { documentLookupEpisodeKeys } : {}),
  };
};

/**
 * Derives the patient field values used to populate document header placeholders.
 * @param patient - Patient demographic data
 * @returns Map of field names to display values (nombre, rut, edad, etc.)
 */
export const buildClinicalDocumentPatientFieldValues = (
  patient: PatientData
): Record<string, string> => ({
  nombre: patient.patientName || '',
  rut: patient.rut || '',
  edad: patient.age || calculateAge(patient.birthDate),
  fecnac: patient.birthDate || '',
  fing: resolveClinicalEpisodeAdmissionDate(patient) || '',
  finf: resolveClinicalDocumentDischargeDateValue(patient),
  hinf: getCurrentTimeValue(),
});
