import type { PatientData } from '@/types/domain/patient';

import type { CensusLabPatient } from '@/shared/contracts/censusLaboratory';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';
import { isValidRut, normalizeRut, isSameRut } from '@/utils/rutUtils';
import { isCalendarDate } from '@/utils/clinicalDateUtils';

/** Each crib has its own identity. Missing RUNs are excluded, never replaced by the mother's. */
export const buildCensusLaboratoryCohort = (
  rows: readonly UnifiedBedRow[],
  beds: Record<string, PatientData>,
  censusDate: string
): { patients: CensusLabPatient[]; excluded: number } => {
  const patients: CensusLabPatient[] = [];
  let excluded = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'occupied' || !row.data.patientName.trim() || row.data.isBlocked) continue;
    const data = row.data;
    const episodeId = data.clinicalEpisodeId?.trim();
    const rutBody = normalizeRut(data.rut).slice(0, -1);
    if (
      data.documentType === 'Pasaporte' ||
      data.identityStatus === 'provisional' ||
      (row.isSubRow && isSameRut(data.rut, beds[row.bed.id]?.rut)) ||
      !isValidRut(data.rut) ||
      !/^\d{5,9}$/.test(rutBody) ||
      !episodeId ||
      episodeId.length > 128 ||
      !isCalendarDate(data.admissionDate) ||
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
