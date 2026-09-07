import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';
import {
  CLINICAL_AUTHORITY_BED_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
} from '@/services/storage/dailyRecordAuthorityContract';

const clinicalFields = new Set<string>([
  ...RAYEN_OWNED_CLINICAL_FIELDS,
  ...CLINICAL_AUTHORITY_BED_FIELDS,
  ...SERVER_ONLY_CLINICAL_PATCH_FIELDS,
]);

const structuralPatientEntries = (patient: PatientData, prefix: string): [string, unknown][] =>
  Object.entries(patient).flatMap(([field, value]): [string, unknown][] => {
    if (clinicalFields.has(field)) return [];
    const path = `${prefix}.${field}`;
    return field === 'clinicalCrib' && patient.clinicalCrib
      ? structuralPatientEntries(patient.clinicalCrib, path)
      : [[path, value]];
  });

/** Leaf paths preserve unrelated beds and historical clinical fields through applyPatches. */
export const buildHistoricalAdmissionPatch = (
  before: DailyRecord,
  after: DailyRecord
): DailyRecordPatch =>
  Object.fromEntries(
    Object.entries(after.beds)
      .filter(([bedId, patient]) => patient !== before.beds[bedId])
      .flatMap(([bedId, patient]) => structuralPatientEntries(patient, `beds.${bedId}`))
  ) as DailyRecordPatch;
