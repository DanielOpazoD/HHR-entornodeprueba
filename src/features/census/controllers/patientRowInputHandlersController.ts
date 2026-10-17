import type { PatientRowSaveResult } from '@/features/census/components/patient-row/inputCellTypes';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type {
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientFieldValue } from '@/types/valueTypes';

interface BuildPatientRowInputCommandsParams {
  updateField: (field: PatientRowPatientField, value: PatientFieldValue) => void;
  updateMultiple: (fields: PatientRowPatientPatch) => PatientRowSaveResult;
}

export interface PatientRowInputCommands {
  setTextField: (field: PatientRowPatientField, value: string) => void;
  setCheckboxField: (field: PatientRowPatientField, checked: boolean) => void;
  setDevices: (newDevices: string[]) => void;
  setDeviceDetails: (details: DeviceDetails) => void;
  setDeviceHistory: (history: DeviceInstance[]) => void;
  saveDemographics: (updatedFields: PatientRowPatientPatch) => PatientRowSaveResult;
}

export const buildPatientRowInputCommands = ({
  updateField,
  updateMultiple,
}: BuildPatientRowInputCommandsParams): PatientRowInputCommands => ({
  setTextField: (field, value) => {
    updateField(field, value);
  },
  setCheckboxField: (field, checked) => {
    updateField(field, checked);
  },
  setDevices: newDevices => {
    updateField('devices', newDevices);
  },
  setDeviceDetails: details => {
    updateField('deviceDetails', details);
  },
  setDeviceHistory: history => {
    updateField('deviceInstanceHistory', history);
  },
  saveDemographics: updatedFields => {
    return updateMultiple(updatedFields);
  },
});
