import type { DeviceDetails, DeviceInstance, PatientData, PatientFieldValue } from '@/types';

interface BuildPatientRowInputCommandsParams {
  updateField: (field: keyof PatientData, value: PatientFieldValue) => void;
  updateMultiple: (fields: Partial<PatientData>) => void;
}

export interface PatientRowInputCommands {
  setTextField: (field: keyof PatientData, value: string) => void;
  setCheckboxField: (field: keyof PatientData, checked: boolean) => void;
  setDevices: (newDevices: string[]) => void;
  setDeviceDetails: (details: DeviceDetails) => void;
  setDeviceHistory: (history: DeviceInstance[]) => void;
  saveDemographics: (updatedFields: Partial<PatientData>) => void;
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
    updateMultiple(updatedFields);
  },
});
