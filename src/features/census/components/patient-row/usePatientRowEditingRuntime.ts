import { usePatientRowHandlersModel } from './usePatientRowHandlersModel';
import type {
  PatientData,
  PatientRowPatientDocumentType,
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientFieldValue } from '@/types/valueTypes';

interface UsePatientRowEditingRuntimeParams {
  bedId: string;
  currentDateString: string;
  data: PatientData;
  documentType?: PatientRowPatientDocumentType;
  updatePatient: (bedId: string, field: PatientRowPatientField, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: PatientRowPatientPatch) => void;
  clearPatient: (bedId: string) => Promise<boolean>;
  updateClinicalCrib: (
    bedId: string,
    field: PatientRowPatientField,
    value: PatientFieldValue
  ) => void;
  updateClinicalCribMultiple: (bedId: string, fields: PatientRowPatientPatch) => void;
}

export const usePatientRowEditingRuntime = ({
  bedId,
  currentDateString,
  data,
  documentType,
  updatePatient,
  updatePatientMultiple,
  clearPatient,
  updateClinicalCrib,
  updateClinicalCribMultiple,
}: UsePatientRowEditingRuntimeParams) =>
  usePatientRowHandlersModel({
    bedId,
    currentDateString,
    data,
    documentType,
    updatePatient,
    updatePatientMultiple,
    clearPatient,
    updateClinicalCrib,
    updateClinicalCribMultiple,
  });
