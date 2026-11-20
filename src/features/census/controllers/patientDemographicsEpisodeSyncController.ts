import type { PatientData } from '@/types/domain/patient';

import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  defaultDailyRecordReadPort,
  defaultDailyRecordWritePort,
  type DailyRecordReadPort,
  type DailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import type { PatientRowPatientPatch } from '@/features/census/components/patient-row/patientRowContracts';
import { createScopedLogger, type ScopedLogger } from '@/services/utils/loggerScope';
import { parseCalendarDateUtcNoon } from '@/utils/clinicalDateUtils';
import { editsEloisaNameParts } from '@/utils/patientNamePartsSource';
import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import { resolveAccreditedClinicalEpisodeId as accreditedEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';

const patientDemographicsEpisodeSyncLogger = createScopedLogger('PatientDemographicsEpisodeSync');

const EPISODE_DEMOGRAPHIC_FIELDS = [
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'identityStatus',
  'rut',
  'documentType',
  'age',
  'birthDate',
  'insurance',
  'admissionOrigin',
  'admissionOriginDetails',
  'origin',
  'isRapanui',
  'biologicalSex',
] as const satisfies readonly (keyof PatientData)[];

type EpisodeDemographicField = (typeof EPISODE_DEMOGRAPHIC_FIELDS)[number];

type EpisodeDemographicsReadRepository = Pick<
  DailyRecordReadPort,
  'getAvailableDates' | 'getForDate'
>;

type EpisodeDemographicsWriteRepository = Pick<DailyRecordWritePort, 'updatePartial'>;

interface HarmonizeEpisodeDemographicsHistoryInput {
  currentDate: string;
  sourcePatient: PatientData;
  updatedFields: PatientRowPatientPatch;
  isClinicalCribPatient?: boolean;
  dailyRecordReadRepository?: EpisodeDemographicsReadRepository;
  dailyRecordWriteRepository?: EpisodeDemographicsWriteRepository;
  logger?: ScopedLogger;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// Episodes last days or weeks; past a year the full listing below is the cheaper read.
const MAX_EPISODE_CALENDAR_DAYS = 366;

/**
 * Calendar days from the first day the patient was seen up to, but not including, today. Reading
 * each day directly (a day without a census reads as missing) replaces listing every stored day,
 * which downloads the whole census history. Null keeps that listing for non-ISO or very long spans.
 */
const listEpisodeCalendarDays = (firstSeenDate: string, currentDate: string): string[] | null => {
  if (!ISO_DATE.test(firstSeenDate) || !ISO_DATE.test(currentDate)) return null;
  const start = parseCalendarDateUtcNoon(firstSeenDate);
  const end = parseCalendarDateUtcNoon(currentDate);
  if (start === null || end === null) return null;
  const span = Math.round((end - start) / DAY_MS);
  if (span <= 0 || span > MAX_EPISODE_CALENDAR_DAYS) return null;
  return Array.from({ length: span }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10)
  );
};

const normalizePatientName = (patientName?: string): string =>
  (patientName ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const hasOwn = <T extends object, K extends PropertyKey>(
  value: T,
  key: K
): key is Extract<K, keyof T> => Object.prototype.hasOwnProperty.call(value, key);

const pickDemographicUpdates = (
  updatedFields: PatientRowPatientPatch
): Partial<Pick<PatientData, EpisodeDemographicField>> => {
  const result: Partial<Pick<PatientData, EpisodeDemographicField>> = {};

  for (const field of EPISODE_DEMOGRAPHIC_FIELDS) {
    if (hasOwn(updatedFields, field)) {
      (result as Record<EpisodeDemographicField, PatientData[EpisodeDemographicField] | undefined>)[
        field
      ] = updatedFields[field] as PatientData[EpisodeDemographicField];
    }
  }

  return result;
};

/** Any text in the document field, even a marker such as `S/R` or a passport of letters only. */
const hasDocument = (patient: PatientData): boolean => (patient.rut ?? '').trim().length > 0;

/**
 * The canonical RUT of a patient declared `RUT` whose check digit is correct, written only with
 * ASCII digits (`isValidRut` would drop any other numeral); null for anything else.
 */
const declaredValidRut = (patient: PatientData): string | null => {
  const value = patient.rut ?? '';
  return patient.documentType === 'RUT' && isValidRut(value) && !/[^\P{N}0-9]/u.test(value)
    ? normalizeRut(value)
    : null;
};

/**
 * Without the same accredited episode, an earlier day is this patient only when both are declared
 * RUT, both RUTs are valid and they are the same RUT (ID-01). A passport, a missing or different
 * type or an invalid RUT matches nothing, so a passport without an accredited episode gets no
 * correction on earlier days. The name decides only when both document fields are empty.
 */
const matchesPatientIdentity = (sourcePatient: PatientData, candidate: PatientData): boolean => {
  if (hasDocument(sourcePatient) || hasDocument(candidate)) {
    const rut = declaredValidRut(sourcePatient);
    return rut !== null && rut === declaredValidRut(candidate);
  }

  const sourceName = normalizePatientName(sourcePatient.patientName);
  const candidateName = normalizePatientName(candidate.patientName);

  return sourceName.length > 0 && sourceName === candidateName;
};

const resolveMatchBasePath = ({
  bedId,
  isClinicalCribPatient,
}: {
  bedId: string;
  isClinicalCribPatient: boolean;
}): string => (isClinicalCribPatient ? `beds.${bedId}.clinicalCrib` : `beds.${bedId}`);

/**
 * The one patient of that day who is this episode (ID-02, ID-03). Same document or name is a
 * candidate, unless both carry accredited episodes that differ (a real readmission). An equal
 * accredited episode wins; without one, an adult's single candidate keeps updating as before,
 * while a newborn (provisional names repeat) needs its accredited episode. More than one
 * candidate is ambiguous: that day is not written.
 */
const findMatchingPatientPath = ({
  recordBeds,
  sourcePatient,
  sourceFirstSeenDate,
  isClinicalCribPatient,
}: {
  recordBeds: Record<string, PatientData>;
  sourcePatient: PatientData;
  sourceFirstSeenDate: string;
  isClinicalCribPatient: boolean;
}): { patient: PatientData; basePath: string } | null => {
  const sourceEpisode = accreditedEpisodeId(sourcePatient);
  const candidates: Array<{ patient: PatientData; basePath: string; episode?: string }> = [];
  for (const [bedId, bedPatient] of Object.entries(recordBeds)) {
    const candidate = isClinicalCribPatient ? bedPatient.clinicalCrib : bedPatient;
    if (!candidate) {
      continue;
    }

    // The same accredited episode is this patient even if that day's document reads otherwise.
    const episode = accreditedEpisodeId(candidate);
    const sameEpisode = Boolean(sourceEpisode) && episode === sourceEpisode;
    if (!sameEpisode && !matchesPatientIdentity(sourcePatient, candidate)) {
      continue;
    }

    if (candidate.firstSeenDate && candidate.firstSeenDate !== sourceFirstSeenDate) {
      continue;
    }

    if (sourceEpisode && episode && episode !== sourceEpisode) {
      continue;
    }

    candidates.push({
      patient: candidate,
      basePath: resolveMatchBasePath({ bedId, isClinicalCribPatient }),
      episode,
    });
  }

  const accredited = sourceEpisode
    ? candidates.filter(({ episode }) => episode === sourceEpisode)
    : [];
  const eligible = accredited.length > 0 ? accredited : isClinicalCribPatient ? [] : candidates;
  const [only, ...others] = eligible;
  return only && others.length === 0 ? { patient: only.patient, basePath: only.basePath } : null;
};

const buildDemographicsPatch = ({
  basePath,
  patient,
  updatedFields,
}: {
  basePath: string;
  patient: PatientData;
  updatedFields: Partial<Pick<PatientData, EpisodeDemographicField>>;
}): DailyRecordPatch => {
  const patch: DailyRecordPatch = {};

  for (const field of EPISODE_DEMOGRAPHIC_FIELDS) {
    if (!hasOwn(updatedFields, field)) {
      continue;
    }

    const nextValue = updatedFields[field];
    if (Object.is(patient[field], nextValue)) {
      continue;
    }

    patch[`${basePath}.${field}`] = nextValue;
  }
  if (editsEloisaNameParts(patient, updatedFields)) {
    patch[`${basePath}.namePartsSource`] = undefined;
  }

  return patch;
};

export const harmonizeEpisodeDemographicsHistory = async ({
  currentDate,
  sourcePatient,
  updatedFields,
  isClinicalCribPatient = false,
  dailyRecordReadRepository = defaultDailyRecordReadPort,
  dailyRecordWriteRepository = defaultDailyRecordWritePort,
}: HarmonizeEpisodeDemographicsHistoryInput): Promise<void> => {
  const sourceFirstSeenDate = sourcePatient.firstSeenDate?.trim();
  if (!sourceFirstSeenDate || sourceFirstSeenDate >= currentDate) {
    return;
  }

  const demographicUpdates = pickDemographicUpdates(updatedFields);
  if (Object.keys(demographicUpdates).length === 0) {
    return;
  }

  const episodeDates =
    listEpisodeCalendarDays(sourceFirstSeenDate, currentDate) ??
    (await dailyRecordReadRepository.getAvailableDates())
      .filter(date => date >= sourceFirstSeenDate && date < currentDate)
      .sort();

  for (const date of episodeDates) {
    const record = await dailyRecordReadRepository.getForDate(date);
    if (!record) {
      continue;
    }

    const match = findMatchingPatientPath({
      recordBeds: record.beds,
      sourcePatient,
      sourceFirstSeenDate,
      isClinicalCribPatient,
    });
    if (!match) {
      continue;
    }

    const patch = buildDemographicsPatch({
      basePath: match.basePath,
      patient: match.patient,
      updatedFields: demographicUpdates,
    });
    if (Object.keys(patch).length === 0) {
      continue;
    }

    await dailyRecordWriteRepository.updatePartial(date, patch);
  }
};

export const harmonizeEpisodeDemographicsHistorySafely = (
  input: HarmonizeEpisodeDemographicsHistoryInput
): void => {
  const logger = input.logger ?? patientDemographicsEpisodeSyncLogger;

  void harmonizeEpisodeDemographicsHistory(input).catch(error => {
    logger.warn('Failed to harmonize demographics across episode history', {
      currentDate: input.currentDate,
      patientName: input.sourcePatient.patientName,
      rut: input.sourcePatient.rut,
      isClinicalCribPatient: input.isClinicalCribPatient ?? false,
      error,
    });
  });
};
