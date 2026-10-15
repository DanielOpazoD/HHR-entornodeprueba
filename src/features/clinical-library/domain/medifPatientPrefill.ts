import { BEDS } from '@/constants/beds';
import type { DailyRecordRawExportState } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/shared/contracts/patientDomainContracts';

/** Read-only census projection. No remote lookups or patient writes belong here. */
export type MedifSourceRecord = Pick<DailyRecordRawExportState, 'date' | 'beds'> &
  Partial<Pick<DailyRecordRawExportState, 'activeExtraBeds' | 'lastUpdated'>>;

export type MedifPatientLocation = 'bed' | 'clinicalCrib';

export type MedifPatientSnapshot = Pick<
  PatientData,
  | 'patientName'
  | 'age'
  | 'birthDate'
  | 'pathology'
  | 'clinicalEpisodeId'
  | 'admissionDate'
  | 'identityStatus'
>;

export interface MedifPatientOption {
  key: string;
  label: string;
  bedId: string;
  bedLabel: string;
  location: MedifPatientLocation;
  patientName: string;
  recordDate: string;
  sourceLastUpdated: string;
  sourceSnapshot: MedifPatientSnapshot;
}

export interface MedifFieldProvenance {
  source: 'hhr';
  sourcePath: string;
  recordDate: string;
  sourceLastUpdated: string;
  transformation: string;
  requiresReview: true;
}

export interface MedifPatientPrefill {
  fields: Record<string, string>;
  provenance: Record<string, MedifFieldProvenance>;
  context: {
    mode: 'hospitalized';
    source: 'hhr';
    recordDate: string;
    sourceLastUpdated: string;
    bedId: string;
    bedLabel: string;
    location: MedifPatientLocation;
    clinicalEpisodeId: string | null;
    requiresReview: true;
  };
}

const trim = (value: string | undefined): string => value?.trim() ?? '';

const parseCalendarDay = (value: string | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, timestamp: date.getTime() };
};

/** Age on the selected census day, preserving months/days for infants. */
const ageAtCensusDate = (birthDate: string | undefined, referenceDate: string): string => {
  const birth = parseCalendarDay(birthDate);
  const reference = parseCalendarDay(referenceDate);
  if (!birth || !reference || birth.timestamp > reference.timestamp) return '';

  const beforeBirthday =
    reference.month < birth.month || (reference.month === birth.month && reference.day < birth.day);
  const years = reference.year - birth.year - Number(beforeBirthday);
  if (years > 0) return `${years} ${years === 1 ? 'año' : 'años'}`;

  const months =
    (reference.year - birth.year) * 12 +
    reference.month -
    birth.month -
    Number(reference.day < birth.day);
  if (months > 0) return `${months} ${months === 1 ? 'mes' : 'meses'}`;

  const days = Math.floor((reference.timestamp - birth.timestamp) / 86_400_000);
  return `${days} ${days === 1 ? 'día' : 'días'}`;
};

/**
 * Snapshot only the fields used by MEDIF. A clinical crib is a separate person;
 * CMA and discharged/transferred rows are not hospitalized patient options.
 */
export const buildMedifPatientOptions = (
  record: MedifSourceRecord | null
): MedifPatientOption[] => {
  if (!record || !parseCalendarDay(record.date)) return [];
  const activeExtras = new Set(record.activeExtraBeds ?? []);
  const options: MedifPatientOption[] = [];

  const addPatient = (
    patient: PatientData | undefined,
    bedId: string,
    bedLabel: string,
    location: MedifPatientLocation
  ): void => {
    if (!patient || patient.isBlocked || !trim(patient.patientName)) return;
    const sourceSnapshot: MedifPatientSnapshot = {
      patientName: trim(patient.patientName),
      age: trim(patient.age),
      birthDate: trim(patient.birthDate),
      pathology: trim(patient.pathology),
      clinicalEpisodeId: trim(patient.clinicalEpisodeId),
      admissionDate: trim(patient.admissionDate),
      identityStatus: patient.identityStatus,
    };
    // Legacy episodes still need a distinct key when a bed is reused.
    const episodeKey = sourceSnapshot.clinicalEpisodeId
      ? `episode:${sourceSnapshot.clinicalEpisodeId}`
      : JSON.stringify([sourceSnapshot.patientName, sourceSnapshot.admissionDate]);
    options.push({
      key: JSON.stringify([record.date, bedId, location, episodeKey]),
      label: `${bedLabel}${location === 'clinicalCrib' ? ' · Cuna clínica' : ''} — ${sourceSnapshot.patientName}`,
      bedId,
      bedLabel,
      location,
      patientName: sourceSnapshot.patientName,
      recordDate: record.date,
      sourceLastUpdated: record.lastUpdated ?? '',
      sourceSnapshot,
    });
  };

  for (const bed of BEDS) {
    if (bed.id.startsWith('CMA_') || (bed.isExtra && !activeExtras.has(bed.id))) continue;
    const patient = record.beds[bed.id];
    if (!patient || patient.isBlocked || !(trim(patient.patientName) || trim(patient.rut))) {
      continue;
    }
    const bedLabel = trim(patient.bedName) || bed.name;
    addPatient(patient, bed.id, bedLabel, 'bed');
    addPatient(patient.clinicalCrib, bed.id, bedLabel, 'clinicalCrib');
  }

  return options;
};

/** Only direct, reviewable facts; never populate signatures or clinical judgments. */
export const prefillMedifPatient = (option: MedifPatientOption): MedifPatientPrefill => {
  const fields: Record<string, string> = {};
  const provenance: Record<string, MedifFieldProvenance> = {};
  const patient = option.sourceSnapshot;
  const root = `beds.${option.bedId}${option.location === 'clinicalCrib' ? '.clinicalCrib' : ''}`;
  const put = (
    fieldId: string,
    value: string,
    sourceField: string,
    transformation = 'copy'
  ): void => {
    if (!value) return;
    fields[fieldId] = value;
    provenance[fieldId] = {
      source: 'hhr',
      sourcePath: `${root}.${sourceField}`,
      recordDate: option.recordDate,
      sourceLastUpdated: option.sourceLastUpdated,
      transformation,
      requiresReview: true,
    };
  };

  put('p1_nombre_pasajero', trim(patient.patientName), 'patientName');
  put('p2_nombre_paciente', trim(patient.patientName), 'patientName');
  const storedAge = trim(patient.age);
  const age = storedAge || ageAtCensusDate(patient.birthDate, option.recordDate);
  const ageSource = storedAge ? 'age' : 'birthDate';
  const ageTransformation = storedAge ? 'copy' : `calendarAgeAt:${option.recordDate}`;
  put('p1_edad', age, ageSource, ageTransformation);
  put('p2_edad', age, ageSource, ageTransformation);
  put('p2_diagnostico_actual', trim(patient.pathology), 'pathology', 'copyAsDraft');

  return {
    fields,
    provenance,
    context: {
      mode: 'hospitalized',
      source: 'hhr',
      recordDate: option.recordDate,
      sourceLastUpdated: option.sourceLastUpdated,
      bedId: option.bedId,
      bedLabel: option.bedLabel,
      location: option.location,
      clinicalEpisodeId: trim(patient.clinicalEpisodeId) || null,
      requiresReview: true,
    },
  };
};
