import type {
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';

const CLINICAL_INITIAL_BLOCK_FIELDS = new Set<PatientRowPatientField>(['pathology']);

export const isClinicalInitialBlockField = (field: PatientRowPatientField): boolean =>
  CLINICAL_INITIAL_BLOCK_FIELDS.has(field);

export const hasPatientRowPatchFields = (fields: PatientRowPatientPatch): boolean =>
  Object.keys(fields).length > 0;
