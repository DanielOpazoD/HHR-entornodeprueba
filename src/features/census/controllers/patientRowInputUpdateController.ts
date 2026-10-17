import type { PatientRowSaveResult } from '@/features/census/components/patient-row/inputCellTypes';
import type {
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientFieldValue } from '@/types/valueTypes';

interface BuildPatientFieldUpdaterParams {
  bedId: string;
  updateSingle: (bedId: string, field: PatientRowPatientField, value: PatientFieldValue) => void;
}

interface BuildPatientMultipleUpdaterParams {
  bedId: string;
  updateMany: (bedId: string, fields: PatientRowPatientPatch) => PatientRowSaveResult;
}

export const buildPatientFieldUpdater = ({
  bedId,
  updateSingle,
}: BuildPatientFieldUpdaterParams) => {
  return (field: PatientRowPatientField, value: PatientFieldValue) => {
    updateSingle(bedId, field, value);
  };
};

export const buildPatientMultipleUpdater = ({
  bedId,
  updateMany,
}: BuildPatientMultipleUpdaterParams) => {
  return (fields: PatientRowPatientPatch) => {
    return updateMany(bedId, fields);
  };
};
