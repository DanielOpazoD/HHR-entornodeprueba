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

const normalizeKeyPart = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildStableKey = (patient: HandoffPatientContract, fallbackBedId: string): string => {
  const episodeId = patient.clinicalEpisodeId?.trim();
  if (episodeId) {
    return `episode:${episodeId}`;
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

    const crib = patient.clinicalCrib;
    if (patient.hasCompanionCrib && crib && !crib.isBlocked && crib.patientName.trim()) {
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
