import type { PatientData } from '@/types/domain/patient';

import type { CensusLabPatient } from '@/shared/contracts/censusLaboratory';
import type { BedDefinition } from '@/types/domain/beds';

import { buildCensusBedRows } from './censusTableViewController';
import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import { parseCalendarDateUtcNoon } from '@/utils/clinicalDateUtils';

const isValidAdmissionDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = parseCalendarDateUtcNoon(value);
  if (timestamp === null) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(timestamp);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/** Each crib has its own identity. Missing RUNs are excluded, never replaced by the mother's. */
export const buildCensusLaboratoryCohort = (
  visibleBeds: BedDefinition[],
  beds: Record<string, PatientData>,
  censusDate: string
): { patients: CensusLabPatient[]; excluded: number } => {
  const patients: CensusLabPatient[] = [];
  let excluded = 0;
  const seen = new Set<string>();
  for (const row of buildCensusBedRows({ visibleBeds, beds }).unifiedRows) {
    if (row.kind !== 'occupied' || !row.data.patientName.trim() || row.data.isBlocked) continue;
    const data = row.data;
    const episodeId = data.clinicalEpisodeId?.trim();
    const rutBody = normalizeRut(data.rut).slice(0, -1);
    if (
      data.documentType === 'Pasaporte' ||
      data.identityStatus === 'provisional' ||
      (row.isSubRow && normalizeRut(data.rut) === normalizeRut(beds[row.bed.id]?.rut)) ||
      !isValidRut(data.rut) ||
      !/^\d{5,9}$/.test(rutBody) ||
      !episodeId ||
      episodeId.length > 128 ||
      !isValidAdmissionDay(data.admissionDate) ||
      data.admissionDate > censusDate
    ) {
      excluded += 1;
      continue;
    }
    const key = `${rutBody}:${episodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    patients.push({
      rutBody,
      episodeId,
      admissionDate: data.admissionDate,
      patientName: data.patientName,
      bedLabel: `${row.bed.id}${row.isSubRow ? ' · Cuna' : ''}`,
    });
  }
  return { patients, excluded };
};
