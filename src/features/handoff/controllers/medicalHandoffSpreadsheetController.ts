import hashJs from 'hash.js';
import type { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { HandoffPatientContract } from '@/domain/handoff/patientContracts';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { resolveVisibleTreatingPhysicianName } from '@/services/staff/treatingPhysicianCatalog';
import {
  LEGACY_EPISODE_ID_PREFIX,
  resolveAccreditedClinicalEpisodeId,
} from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';

export interface MedicalHandoffSpreadsheetRow {
  stableKey: string;
  bed: string;
  patientName: string;
  age: string;
  admissionDate: string;
  diagnosis: string;
  specialty: string;
  treatingPhysician: string;
}

export const MEDICAL_HANDOFF_SPREADSHEET_MAX_ROWS = 80;

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatPatientNameWithAge = (patientName: string, age: string): string => {
  const normalizedName = normalizeText(patientName);
  const normalizedAge = normalizeText(age);
  return normalizedAge ? `${normalizedName} (${normalizedAge})` : normalizedName;
};

const formatAdmissionDate = (value: string): string => {
  const normalized = normalizeText(value);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  return isoMatch ? `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}` : normalized;
};

const hashStableKeyPart = (value: string): string =>
  hashJs
    .sha384()
    .update(new TextEncoder().encode(value))
    .digest()
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

const normalizeKeyPart = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildStableKey = (patient: HandoffPatientContract, fallbackBedId: string): string => {
  const episodeId = normalizeText(patient.clinicalEpisodeId);
  if (episodeId) {
    return `episode-h1:${hashStableKeyPart(episodeId)}`;
  }

  return `bed:${normalizeKeyPart(fallbackBedId)}:${normalizeKeyPart(patient.patientName)}`;
};

/**
 * A `legacy_ep_` crib id is a hash of name and admission: two newborns «RN» share it. Their
 * mothers' accredited admissions tell them apart (ID-03). Used only when the same export repeats
 * the key, so a single newborn keeps the row it had, also after «Solo Madre» moves it to the bed.
 */
const motherSeparatedCribKey = (
  crib: HandoffPatientContract,
  mother: HandoffPatientContract
): string | undefined => {
  const episodeId = normalizeText(crib.clinicalEpisodeId);
  const motherEpisodeId = episodeId.startsWith(LEGACY_EPISODE_ID_PREFIX)
    ? resolveAccreditedClinicalEpisodeId({
        clinicalEpisodeId: normalizeText(mother.clinicalEpisodeId),
      })
    : undefined;
  return motherEpisodeId
    ? `episode-h1:${hashStableKeyPart(`${motherEpisodeId}\n${episodeId}`)}`
    : undefined;
};

const buildRow = ({
  patient,
  bedLabel,
  fallbackBedId,
  professionalsCatalog,
}: {
  patient: HandoffPatientContract;
  bedLabel: string;
  fallbackBedId: string;
  professionalsCatalog: ProfessionalCatalogItem[];
}): MedicalHandoffSpreadsheetRow => ({
  stableKey: buildStableKey(patient, fallbackBedId),
  bed: bedLabel,
  patientName: formatPatientNameWithAge(patient.patientName, patient.age),
  age: normalizeText(patient.age),
  admissionDate: formatAdmissionDate(patient.admissionDate),
  diagnosis: normalizeText(patient.pathology),
  specialty: normalizeText(patient.specialty),
  treatingPhysician: resolveVisibleTreatingPhysicianName(
    professionalsCatalog,
    patient.treatingPhysicianId,
    patient.treatingPhysicianName
  ),
});

export const buildMedicalHandoffSpreadsheetRows = (
  record: HandoffDailyRecordContract,
  visibleBeds: readonly BedDefinition[],
  professionalsCatalog: ProfessionalCatalogItem[]
): MedicalHandoffSpreadsheetRow[] => {
  const rows: MedicalHandoffSpreadsheetRow[] = [];
  const separatedKeys = new Map<MedicalHandoffSpreadsheetRow, string>();

  visibleBeds.forEach(bed => {
    const patient = record.beds[bed.id];
    if (!patient || patient.isBlocked || !normalizeText(patient.patientName)) {
      return;
    }

    rows.push(
      buildRow({
        patient,
        bedLabel: bed.name || bed.id,
        fallbackBedId: bed.id,
        professionalsCatalog,
      })
    );

    // `clinicalCrib` is the current source of truth. `hasCompanionCrib` is a
    // legacy presentation flag and can remain false on migrated active cribs.
    const crib = patient.clinicalCrib;
    if (crib && normalizeText(crib.patientName)) {
      const row = buildRow({
        patient: crib,
        bedLabel: `Cuna RN (${bed.name || bed.id})`,
        fallbackBedId: `${bed.id}-cuna-rn`,
        professionalsCatalog,
      });
      rows.push(row);
      const separatedKey = motherSeparatedCribKey(crib, patient);
      if (separatedKey) separatedKeys.set(row, separatedKey);
    }
  });

  const keyCount = new Map<string, number>();
  rows.forEach(row => keyCount.set(row.stableKey, (keyCount.get(row.stableKey) ?? 0) + 1));
  return rows.map(row => {
    const separatedKey = separatedKeys.get(row);
    return separatedKey && (keyCount.get(row.stableKey) ?? 0) > 1
      ? { ...row, stableKey: separatedKey }
      : row;
  });
};
