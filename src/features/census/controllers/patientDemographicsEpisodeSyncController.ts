import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import {
  defaultDailyRecordReadPort,
  defaultDailyRecordWritePort,
  type DailyRecordReadPort,
  type DailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import type {
  PatientData,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import { createScopedLogger, type ScopedLogger } from '@/services/utils/loggerScope';
import { parseCalendarDateUtcNoon } from '@/utils/clinicalDateUtils';

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

const normalizeRut = (rut?: string): string =>
  (rut ?? '')
    .replace(/[^0-9kK]/g, '')
    .toLowerCase()
    .trim();

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

const matchesPatientIdentity = (sourcePatient: PatientData, candidate: PatientData): boolean => {
  const sourceRut = normalizeRut(sourcePatient.rut);
  const candidateRut = normalizeRut(candidate.rut);

  if (sourceRut && candidateRut) {
    return sourceRut === candidateRut;
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
  for (const [bedId, bedPatient] of Object.entries(recordBeds)) {
    const candidate = isClinicalCribPatient ? bedPatient.clinicalCrib : bedPatient;
    if (!candidate || !matchesPatientIdentity(sourcePatient, candidate)) {
      continue;
    }

    if (candidate.firstSeenDate && candidate.firstSeenDate !== sourceFirstSeenDate) {
      continue;
    }

    return {
      patient: candidate,
      basePath: resolveMatchBasePath({ bedId, isClinicalCribPatient }),
    };
  }

  return null;
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
