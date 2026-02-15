import type { PatientData, PatientFieldValue } from '@/types';

interface BuildPatientFieldUpdaterParams {
  bedId: string;
  updateSingle: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
}

interface BuildPatientMultipleUpdaterParams {
  bedId: string;
  updateMany: (bedId: string, fields: Partial<PatientData>) => void;
}

export const buildPatientFieldUpdater = ({
  bedId,
  updateSingle,
}: BuildPatientFieldUpdaterParams) => {
  return (field: keyof PatientData, value: PatientFieldValue) => {
    updateSingle(bedId, field, value);
  };
};

export const buildPatientMultipleUpdater = ({
  bedId,
  updateMany,
}: BuildPatientMultipleUpdaterParams) => {
  return (fields: Partial<PatientData>) => {
    updateMany(bedId, fields);
  };
};
