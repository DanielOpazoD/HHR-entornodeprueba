import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import { isValidRut } from '@/utils/rutUtils';
import { buildCensusBedRows } from './censusTableViewController';

export interface ClinicalExplorerPatient {
  bedId: string;
  episodeId: string;
  data: PatientData;
}

interface ListClinicalExplorerPatientsParams {
  visibleBeds: BedDefinition[];
  beds: Record<string, PatientData> | null | undefined;
}

/** Same eligibility as the row triggers: every source needs a real RUT and an Eloísa episode. */
export const canExploreClinicalPatient = (data: PatientData): boolean => {
  const rut = data.rut.trim();
  return Boolean(
    data.patientName.trim() &&
      rut &&
      rut !== '-' &&
      data.documentType !== 'Pasaporte' &&
      isValidRut(rut) &&
      data.clinicalEpisodeId?.trim()
  );
};

/** Patients of the census day in bed order. Cribs are left out, as the lab and MMRAD triggers do. */
export const listClinicalExplorerPatients = ({
  visibleBeds,
  beds,
}: ListClinicalExplorerPatientsParams): ClinicalExplorerPatient[] =>
  buildCensusBedRows({ visibleBeds, beds }).unifiedRows.flatMap(row =>
    row.kind === 'occupied' && !row.isSubRow && canExploreClinicalPatient(row.data)
      ? [{ bedId: row.bed.id, episodeId: row.data.clinicalEpisodeId!.trim(), data: row.data }]
      : []
  );

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const filterClinicalExplorerPatients = (
  patients: ClinicalExplorerPatient[],
  query: string
): ClinicalExplorerPatient[] => {
  const needle = normalize(query);
  if (!needle) return patients;
  return patients.filter(patient =>
    normalize(`${patient.data.patientName} ${patient.data.rut} ${patient.bedId}`).includes(needle)
  );
};

/** The bed before or after the current one in census order; null at either end. */
export const resolveClinicalExplorerNeighbour = (
  patients: ClinicalExplorerPatient[],
  bedId: string,
  step: -1 | 1
): string | null => {
  const index = patients.findIndex(patient => patient.bedId === bedId);
  if (index < 0) return null;
  return patients[index + step]?.bedId ?? null;
};

interface IndicationDayLike {
  active: readonly unknown[];
  suspended: readonly unknown[];
}

/**
 * Days the combined view shows: the newest days with active indications, up to the limit. Only
 * when no day has an active one, the newest days with suspended orders. A treatment on an older
 * day is never hidden behind newer days that only hold suspended orders.
 */
export const resolveCompactIndicationDays = <T extends IndicationDayLike>(
  days: readonly T[],
  limit: number
): T[] => {
  const active = days.filter(day => day.active.length > 0);
  const pool = active.length > 0 ? active : days.filter(day => day.suspended.length > 0);
  return pool.slice(0, limit);
};
