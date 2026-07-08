import type { PatientEpisodeContract } from '@/application/patient-flow/clinicalEpisodeContracts';
import {
  buildClinicalEpisodeKey,
  normalizeClinicalEpisodeId,
  resolveClinicalEpisodeAdmissionDate,
} from '@/application/patient-flow/clinicalEpisode';

const CANONICAL_EPISODE_ID_PREFIX = 'ep_';
export const LEGACY_EPISODE_ID_PREFIX = 'legacy_ep_';

type EpisodePatient = PatientEpisodeContract & {
  bedId?: string;
  pathology?: string;
  clinicalCrib?: EpisodePatient;
};

type EpisodeRecord = {
  beds: Record<string, EpisodePatient>;
};

type EpisodePatch = Record<string, unknown>;

const normalizeGeneratedId = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '');

const createDefaultRandomId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const hasClinicalEpisodeContent = (
  patient: EpisodePatient | undefined
): patient is EpisodePatient => {
  if (!patient) return false;
  return Boolean(
    String(patient.patientName || '').trim() ||
    String(patient.rut || '').trim() ||
    String(patient.admissionDate || '').trim() ||
    String(patient.pathology || '').trim()
  );
};

export const resolveClinicalEpisodeIdForAdmission = (
  input: Pick<PatientEpisodeContract, 'clinicalEpisodeId'>,
  createId: () => string = createDefaultRandomId
): string => {
  const existing = normalizeClinicalEpisodeId(input.clinicalEpisodeId);
  if (existing) {
    return existing;
  }

  return `${CANONICAL_EPISODE_ID_PREFIX}${normalizeGeneratedId(createId())}`;
};

export const buildLegacyClinicalEpisodeId = (
  patient: PatientEpisodeContract
): string | undefined => {
  const episodeKey = buildClinicalEpisodeKey(
    patient.rut || patient.patientName || '',
    resolveClinicalEpisodeAdmissionDate(patient),
    patient.admissionTime
  );

  if (!episodeKey || episodeKey === 'sin-rut__sin-ingreso') {
    return undefined;
  }

  return `${LEGACY_EPISODE_ID_PREFIX}${stableHash(episodeKey.toLowerCase())}`;
};

export const ensurePatientClinicalEpisodeId = <T extends EpisodePatient>(
  patient: T,
  options: {
    createId?: () => string;
    mode?: 'admission' | 'legacy';
  } = {}
): T => {
  const existing = normalizeClinicalEpisodeId(patient.clinicalEpisodeId);
  if (existing) {
    return existing === patient.clinicalEpisodeId
      ? patient
      : { ...patient, clinicalEpisodeId: existing };
  }

  if (!hasClinicalEpisodeContent(patient)) {
    return patient;
  }

  const clinicalEpisodeId =
    options.mode === 'admission'
      ? resolveClinicalEpisodeIdForAdmission(patient, options.createId)
      : buildLegacyClinicalEpisodeId(patient);

  return clinicalEpisodeId ? { ...patient, clinicalEpisodeId } : patient;
};

const ensurePatientTreeClinicalEpisodeId = <T extends EpisodePatient>(patient: T): T => {
  const patientWithId = ensurePatientClinicalEpisodeId(patient);
  if (!patientWithId.clinicalCrib) {
    return patientWithId;
  }

  const cribWithId = ensurePatientClinicalEpisodeId(patientWithId.clinicalCrib);
  return cribWithId === patientWithId.clinicalCrib
    ? patientWithId
    : ({ ...patientWithId, clinicalCrib: cribWithId } as T);
};

export const ensureDailyRecordClinicalEpisodeIds = <TRecord extends EpisodeRecord>(
  record: TRecord
): TRecord => {
  let changed = false;
  const beds = Object.fromEntries(
    Object.entries(record.beds || {}).map(([bedId, patient]) => {
      const patientWithId = ensurePatientTreeClinicalEpisodeId(patient);
      if (patientWithId !== patient) {
        changed = true;
      }
      return [bedId, patientWithId];
    })
  ) as TRecord['beds'];

  return changed ? ({ ...record, beds } as TRecord) : record;
};

export const buildDailyRecordClinicalEpisodeIdPatches = (record: EpisodeRecord): EpisodePatch => {
  const patches: EpisodePatch = {};

  Object.entries(record.beds || {}).forEach(([bedId, patient]) => {
    const patientWithId = ensurePatientClinicalEpisodeId(patient);
    if (patientWithId.clinicalEpisodeId !== patient.clinicalEpisodeId) {
      patches[`beds.${bedId}.clinicalEpisodeId`] = patientWithId.clinicalEpisodeId;
    }

    if (patient.clinicalCrib) {
      const cribWithId = ensurePatientClinicalEpisodeId(patient.clinicalCrib);
      if (cribWithId.clinicalEpisodeId !== patient.clinicalCrib.clinicalEpisodeId) {
        patches[`beds.${bedId}.clinicalCrib.clinicalEpisodeId`] = cribWithId.clinicalEpisodeId;
      }
    }
  });

  return patches;
};
