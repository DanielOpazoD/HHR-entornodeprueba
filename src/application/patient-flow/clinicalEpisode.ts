import type { PatientEpisodeContract } from '@/application/patient-flow/clinicalEpisodeContracts';
import {
  isNewAdmissionForClinicalDay,
  normalizeDateOnly,
  resolveClinicalDayForDateTime,
} from '@/utils/clinicalDayUtils';

export interface ClinicalEpisode {
  patientRut: string;
  patientName: string;
  admissionDate?: string;
  admissionTime?: string;
  sourceDailyRecordDate?: string;
  sourceBedId?: string;
  specialty?: string;
  episodeKey: string;
}

export interface PatientPresenceSnapshot {
  bedId: string;
  patientRut: string;
  patientName: string;
  admissionDate?: string;
  admissionTime?: string;
  episodeKey: string;
}

export interface PatientMovementClassification {
  isNewAdmission: boolean;
}

export interface ClinicalEpisodeFallbackEvent {
  source?: string;
  reason: 'missing_clinical_episode_id';
  fallbackEpisodeKey: string;
  hasRut: boolean;
  hasAdmissionTime: boolean;
}

export interface ClinicalEpisodeResolutionOptions {
  source?: string;
  onFallback?: (event: ClinicalEpisodeFallbackEvent) => void;
}

export interface LegacyClinicalEpisodeKeyParts {
  rut: string;
  admissionDate: string;
  admissionTime?: string;
}

export const normalizeClinicalEpisodeTime = (admissionTime?: string): string =>
  String(admissionTime || '').trim();

export const buildClinicalEpisodeKey = (
  patientRut: string,
  admissionDate?: string,
  admissionTime?: string
): string => {
  const baseKey = `${patientRut || 'sin-rut'}__${admissionDate || 'sin-ingreso'}`;
  const normalizedAdmissionTime = normalizeClinicalEpisodeTime(admissionTime);
  return normalizedAdmissionTime ? `${baseKey}__${normalizedAdmissionTime}` : baseKey;
};

export const normalizeClinicalEpisodeId = (clinicalEpisodeId?: string): string =>
  String(clinicalEpisodeId || '').trim();

export const isCanonicalClinicalEpisodeId = (clinicalEpisodeId?: string): boolean =>
  normalizeClinicalEpisodeId(clinicalEpisodeId).startsWith('ep_');

export const isLegacyClinicalEpisodeKey = (episodeKey: string): boolean =>
  episodeKey.includes('__');

export const parseLegacyClinicalEpisodeKey = (
  episodeKey: string
): LegacyClinicalEpisodeKeyParts | null => {
  const [rut, admissionDate, admissionTime] = episodeKey.split('__');
  if (!rut || !admissionDate) {
    return null;
  }
  return { rut, admissionDate, admissionTime };
};

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const resolveAdmissionDateFromClinicalEpisodeKey = (
  episodeKey: string
): string | undefined => {
  const parsed = parseLegacyClinicalEpisodeKey(episodeKey);
  return parsed && ISO_DATE_ONLY_PATTERN.test(parsed.admissionDate)
    ? parsed.admissionDate
    : undefined;
};

/**
 * Clinical documents and episode snapshots should anchor to the first observed
 * day of the current episode when the census already resolved it.
 */
export const resolveClinicalEpisodeAdmissionDate = (
  patient: PatientEpisodeContract
): string | undefined => patient.firstSeenDate || patient.admissionDate;

const stripRutDots = (rut: string): string => rut.replace(/\./g, '');

const uniqueNonEmpty = (values: Array<string | undefined | null>): string[] =>
  Array.from(
    new Set(values.map(value => String(value || '').trim()).filter(value => value.length > 0))
  );

export const buildClinicalEpisodeKeyCandidates = (
  patient: PatientEpisodeContract,
  primaryEpisodeKey?: string
): string[] => {
  const persistedEpisodeId = normalizeClinicalEpisodeId(patient.clinicalEpisodeId);
  const normalizedPrimaryEpisodeKey = normalizeClinicalEpisodeId(primaryEpisodeKey);
  if (
    isCanonicalClinicalEpisodeId(normalizedPrimaryEpisodeKey) ||
    isCanonicalClinicalEpisodeId(persistedEpisodeId)
  ) {
    return uniqueNonEmpty([primaryEpisodeKey, persistedEpisodeId]);
  }

  const rut = String(patient.rut || '').trim();
  const rutWithoutDots = stripRutDots(rut);
  const admissionDate = resolveClinicalEpisodeAdmissionDate(patient);
  const admissionTime = patient.admissionTime;

  return uniqueNonEmpty([
    primaryEpisodeKey,
    patient.clinicalEpisodeId,
    rut ? buildClinicalEpisodeKey(rut, admissionDate, admissionTime) : undefined,
    rutWithoutDots && rutWithoutDots !== rut
      ? buildClinicalEpisodeKey(rutWithoutDots, admissionDate, admissionTime)
      : undefined,
    rut ? buildClinicalEpisodeKey(rut, admissionDate) : undefined,
    rutWithoutDots && rutWithoutDots !== rut
      ? buildClinicalEpisodeKey(rutWithoutDots, admissionDate)
      : undefined,
  ]);
};

export const buildClinicalEpisodeLookupKeys = (
  patient: PatientEpisodeContract,
  primaryEpisodeKey?: string
): string[] => buildClinicalEpisodeKeyCandidates(patient, primaryEpisodeKey);

const shiftIsoDate = (isoDate: string, deltaDays: number): string | null => {
  if (!ISO_DATE_ONLY_PATTERN.test(isoDate)) return null;
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};

export const buildLegacyClinicalDocumentEpisodeLookupKeys = ({
  rut,
  admissionDate,
  admissionTime,
}: LegacyClinicalEpisodeKeyParts): string[] => {
  const rutWithoutDots = stripRutDots(rut);
  const admissionDates = [
    admissionDate,
    shiftIsoDate(admissionDate, 1),
    shiftIsoDate(admissionDate, -1),
  ].filter((date): date is string => Boolean(date));

  return uniqueNonEmpty(
    admissionDates.flatMap(date => [
      buildClinicalEpisodeKey(rut, date, admissionTime),
      rutWithoutDots && rutWithoutDots !== rut
        ? buildClinicalEpisodeKey(rutWithoutDots, date, admissionTime)
        : undefined,
      buildClinicalEpisodeKey(rut, date),
      rutWithoutDots && rutWithoutDots !== rut
        ? buildClinicalEpisodeKey(rutWithoutDots, date)
        : undefined,
    ])
  );
};

export const resolveClinicalEpisodeIdentifier = (
  patient: PatientEpisodeContract,
  options: ClinicalEpisodeResolutionOptions = {}
): string => {
  const persistedEpisodeId = normalizeClinicalEpisodeId(patient.clinicalEpisodeId);
  if (persistedEpisodeId) {
    return persistedEpisodeId;
  }

  const fallbackEpisodeKey = buildClinicalEpisodeKey(
    patient.rut || '',
    resolveClinicalEpisodeAdmissionDate(patient),
    patient.admissionTime
  );
  options.onFallback?.({
    source: options.source,
    reason: 'missing_clinical_episode_id',
    fallbackEpisodeKey,
    hasRut: Boolean(patient.rut?.trim()),
    hasAdmissionTime: Boolean(normalizeClinicalEpisodeTime(patient.admissionTime)),
  });
  return fallbackEpisodeKey;
};

export const resolveClinicalEpisode = (
  patient: PatientEpisodeContract,
  context?: {
    sourceDailyRecordDate?: string;
    sourceBedId?: string;
  },
  options: ClinicalEpisodeResolutionOptions = {}
): ClinicalEpisode => ({
  patientRut: patient.rut || '',
  patientName: patient.patientName || '',
  admissionDate: resolveClinicalEpisodeAdmissionDate(patient),
  admissionTime: patient.admissionTime,
  sourceDailyRecordDate: context?.sourceDailyRecordDate,
  sourceBedId: context?.sourceBedId,
  specialty: patient.specialty,
  episodeKey: resolveClinicalEpisodeIdentifier(patient, options),
});

export const buildPatientPresenceSnapshot = (
  patient: PatientEpisodeContract,
  bedId: string
): PatientPresenceSnapshot | null => {
  const patientRut = patient.rut?.trim();
  const admissionDate = resolveClinicalEpisodeAdmissionDate(patient)?.trim();
  if (!patientRut || !admissionDate) {
    return null;
  }

  return {
    bedId,
    patientRut,
    patientName: patient.patientName || '',
    admissionDate,
    admissionTime: patient.admissionTime,
    episodeKey: resolveClinicalEpisodeIdentifier(patient),
  };
};

/**
 * Determines whether a patient is a **new admission** on a given census day.
 *
 * Resolution priority:
 *  1. If `firstSeenDate` is set → compare with `recordDate` (modern patients).
 *  2. If `firstSeenDate` is missing but `admissionDate` exists → use
 *     `admissionDate` as anchor (**legacy fallback** for patients created
 *     before `firstSeenDate` was introduced).
 *  3. If neither is set → fall back to `isNewAdmissionForClinicalDay()`
 *     which applies clinical-day shift logic (night shift = next calendar day).
 *
 * A patient is "new" when `recordDate` matches the resolved anchor date.
 * On subsequent days the comparison fails and the badge disappears.
 *
 * @example
 * // Modern patient (firstSeenDate set)
 * classifyPatientMovementForRecord('2026-04-10', {
 *   firstSeenDate: '2026-04-10', admissionDate: '2026-04-10'
 * }); // → { isNewAdmission: true }
 *
 * // Legacy patient (no firstSeenDate)
 * classifyPatientMovementForRecord('2026-04-10', {
 *   admissionDate: '2026-04-10'
 * }); // → { isNewAdmission: true }  (admissionDate fallback)
 *
 * // Next day — no longer new
 * classifyPatientMovementForRecord('2026-04-11', {
 *   firstSeenDate: '2026-04-10', admissionDate: '2026-04-10'
 * }); // → { isNewAdmission: false }
 */
export const classifyPatientMovementForRecord = (
  recordDate: string,
  patient: {
    firstSeenDate?: string;
    admissionDate?: string;
    admissionTime?: string;
  }
): PatientMovementClassification => {
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedFirstSeenDate = normalizeDateOnly(patient.firstSeenDate);
  const normalizedAdmissionDate = normalizeDateOnly(patient.admissionDate);
  const shouldResolveAdmissionAnchor =
    Boolean(normalizedFirstSeenDate) || Boolean(patient.admissionTime);
  const resolvedClinicalAdmissionDate =
    normalizedAdmissionDate && shouldResolveAdmissionAnchor
      ? resolveClinicalEpisodeAdmissionAnchorDate({
          firstSeenDate: normalizedFirstSeenDate,
          admissionDate: normalizedAdmissionDate,
          admissionTime: patient.admissionTime,
        })
      : // Legacy fallback: use admissionDate as anchor when firstSeenDate
        // was never set (patients created before the feature existed).
        normalizedFirstSeenDate || normalizedAdmissionDate;

  if (normalizedRecordDate && resolvedClinicalAdmissionDate) {
    return {
      isNewAdmission: normalizedRecordDate === resolvedClinicalAdmissionDate,
    };
  }

  return {
    isNewAdmission: isNewAdmissionForClinicalDay(
      recordDate,
      patient.admissionDate,
      patient.admissionTime
    ),
  };
};

const resolveClinicalEpisodeAdmissionAnchorDate = ({
  firstSeenDate,
  admissionDate,
  admissionTime,
}: {
  firstSeenDate?: string;
  admissionDate: string;
  admissionTime?: string;
}): string => {
  const clinicalAdmissionDate =
    resolveClinicalDayForAdmission(admissionDate, admissionTime) ?? admissionDate;

  if (!firstSeenDate) {
    return clinicalAdmissionDate;
  }

  return firstSeenDate < clinicalAdmissionDate ? firstSeenDate : clinicalAdmissionDate;
};

const resolveClinicalDayForAdmission = (
  admissionDate?: string,
  admissionTime?: string
): string | undefined => {
  if (!admissionDate) {
    return undefined;
  }

  if (!admissionTime) {
    return admissionDate;
  }

  return resolveClinicalDayForDateTime(admissionDate, admissionTime);
};
