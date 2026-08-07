import hashJs from 'hash.js';
import type { BedDefinition } from '@/types/domain/beds';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import type { HandoffPatientContract } from '@/domain/handoff/patientContracts';

export interface MedicalHandoffSpreadsheetRow {
  stableKey: string;
  bed: string;
  patientName: string;
  age: string;
  diagnosis: string;
  specialty: string;
  treatingPhysician: string;
}

export const MEDICAL_HANDOFF_SPREADSHEET_MAX_ROWS = 80;

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
  const episodeId = patient.clinicalEpisodeId?.trim() || '';
  if (episodeId) {
    return `episode-h1:${hashStableKeyPart(episodeId)}`;
  }

  return `bed:${normalizeKeyPart(fallbackBedId)}:${normalizeKeyPart(patient.patientName)}`;
};

const buildRow = ({
  patient,
  bedLabel,
  fallbackBedId,
}: {
  patient: HandoffPatientContract;
  bedLabel: string;
  fallbackBedId: string;
}): MedicalHandoffSpreadsheetRow => ({
  stableKey: buildStableKey(patient, fallbackBedId),
  bed: bedLabel,
  patientName: patient.patientName.trim(),
  age: patient.age?.trim() || '',
  diagnosis: patient.pathology?.trim() || '',
  specialty: String(patient.specialty || '').trim(),
  treatingPhysician: patient.treatingPhysicianName?.trim() || '',
});

export const buildMedicalHandoffSpreadsheetRows = (
  record: DailyRecord,
  visibleBeds: readonly BedDefinition[]
): MedicalHandoffSpreadsheetRow[] => {
  const rows: MedicalHandoffSpreadsheetRow[] = [];

  visibleBeds.forEach(bed => {
    const patient = record.beds[bed.id];
    if (!patient || patient.isBlocked || !patient.patientName.trim()) {
      return;
    }

    rows.push(
      buildRow({
        patient,
        bedLabel: bed.name || bed.id,
        fallbackBedId: bed.id,
      })
    );

    // `clinicalCrib` is the current source of truth. `hasCompanionCrib` is a
    // legacy presentation flag and can remain false on migrated active cribs.
    const crib = patient.clinicalCrib;
    if (crib?.patientName.trim()) {
      rows.push(
        buildRow({
          patient: crib,
          bedLabel: `Cuna RN (${bed.name || bed.id})`,
          fallbackBedId: `${bed.id}-cuna-rn`,
        })
      );
    }
  });

  return rows;
};
