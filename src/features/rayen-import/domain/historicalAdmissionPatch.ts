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

const diagnosisFields = [
  'pathology',
  'diagnosisComments',
  'snomedCode',
  'cie10Code',
  'cie10Description',
] as const;

export const missingHistoricalDiagnosis = (
  previous: PatientData | undefined,
  patient: PatientData
): Partial<PatientData> =>
  Object.fromEntries(
    diagnosisFields
      .filter(field => !previous?.[field]?.trim() && patient[field]?.trim())
      .map(field => [field, patient[field]])
  );

/** Fill missing values only; existing historical values always win. */
export const buildHistoricalAdmissionDiagnosisPatch = (
  before: DailyRecord,
  after: DailyRecord
): DailyRecordPatch => {
  const entries: [string, unknown][] = [];
  const append = (previous: PatientData | undefined, patient: PatientData, prefix: string) => {
    for (const [field, value] of Object.entries(missingHistoricalDiagnosis(previous, patient)))
      entries.push([`${prefix}.${field}`, value]);
    if (patient.clinicalCrib)
      append(previous?.clinicalCrib, patient.clinicalCrib, `${prefix}.clinicalCrib`);
  };
  for (const [bedId, patient] of Object.entries(after.beds)) {
    if (patient !== before.beds[bedId]) append(before.beds[bedId], patient, `beds.${bedId}`);
  }
  return Object.fromEntries(entries) as DailyRecordPatch;
};

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
