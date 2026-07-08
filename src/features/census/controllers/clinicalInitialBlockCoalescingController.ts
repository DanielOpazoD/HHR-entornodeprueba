import type {
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';

const CLINICAL_INITIAL_BLOCK_FIELDS = new Set<PatientRowPatientField>([
  'pathology',
  'specialty',
  'secondarySpecialty',
  'status',
]);

export interface SplitClinicalInitialBlockPatchResult {
  clinicalFields: PatientRowPatientPatch;
  immediateFields: PatientRowPatientPatch;
}

export const isClinicalInitialBlockField = (field: PatientRowPatientField): boolean =>
  CLINICAL_INITIAL_BLOCK_FIELDS.has(field);

export const splitClinicalInitialBlockPatch = (
  fields: PatientRowPatientPatch
): SplitClinicalInitialBlockPatchResult => {
  const clinicalFields: PatientRowPatientPatch = {};
  const immediateFields: PatientRowPatientPatch = {};
  const assignPatchField = (
    target: PatientRowPatientPatch,
    field: PatientRowPatientField,
    value: unknown
  ) => {
    (target as Record<string, unknown>)[field] = value;
  };

  for (const [field, value] of Object.entries(fields) as [
    PatientRowPatientField,
    PatientRowPatientPatch[PatientRowPatientField],
  ][]) {
    if (isClinicalInitialBlockField(field)) {
      assignPatchField(clinicalFields, field, value);
      continue;
    }

    assignPatchField(immediateFields, field, value);
  }

  return { clinicalFields, immediateFields };
};

export const hasPatientRowPatchFields = (fields: PatientRowPatientPatch): boolean =>
  Object.keys(fields).length > 0;
