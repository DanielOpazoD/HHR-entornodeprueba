import hashJs from 'hash.js';
import type { BedDefinition } from '@/types/domain/beds';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import type { HandoffPatientContract } from '@/domain/handoff/patientContracts';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { resolveVisibleTreatingPhysicianName } from '@/services/staff/treatingPhysicianCatalog';

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
  record: DailyRecord,
  visibleBeds: readonly BedDefinition[],
  professionalsCatalog: ProfessionalCatalogItem[]
): MedicalHandoffSpreadsheetRow[] => {
  const rows: MedicalHandoffSpreadsheetRow[] = [];

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
      rows.push(
        buildRow({
          patient: crib,
          bedLabel: `Cuna RN (${bed.name || bed.id})`,
          fallbackBedId: `${bed.id}-cuna-rn`,
          professionalsCatalog,
        })
      );
    }
  });

  return rows;
};
