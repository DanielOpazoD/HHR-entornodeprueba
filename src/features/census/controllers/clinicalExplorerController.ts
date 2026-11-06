import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import { isValidRut, normalizeRut } from '@/utils/rutUtils';
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

/** Who a request is for: patient and episode (ID-01), never the bed, which is only a place. */
export const clinicalExplorerPatientIdentity = (patient: ClinicalExplorerPatient): string =>
  `${normalizeRut(patient.data.rut)}:${patient.episodeId}`;

export interface ClinicalExplorerExamCandidate {
  key: string;
  /** Where the patient is now. */
  label: string;
  data: PatientData;
}

/**
 * Patients a laboratory request may include, once each. If the census lists one patient and
 * episode in two beds, the first bed in census order stands for that person.
 */
export const listClinicalExplorerExamCandidates = (
  patients: ClinicalExplorerPatient[]
): ClinicalExplorerExamCandidate[] => {
  const seen = new Set<string>();
  return patients.flatMap(patient => {
    const key = clinicalExplorerPatientIdentity(patient);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: patient.bedId, data: patient.data }];
  });
};

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

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
