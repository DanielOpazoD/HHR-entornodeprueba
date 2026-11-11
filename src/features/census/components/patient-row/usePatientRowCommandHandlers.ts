import type { PatientRowSaveResult } from './inputCellTypes';
import { ChangeEvent, useCallback } from 'react';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type {
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientFieldValue } from '@/types/valueTypes';

interface PatientRowUpdates {
  updateField: (field: PatientRowPatientField, value: PatientFieldValue) => void;
  updateMultiple: (fields: PatientRowPatientPatch) => PatientRowSaveResult;
}

interface UsePatientRowCommandHandlersResult {
  handleTextChange: (
    field: PatientRowPatientField
  ) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  handleCheckboxChange: (
    field: PatientRowPatientField
  ) => (e: ChangeEvent<HTMLInputElement>) => void;
  handleDevicesChange: (newDevices: string[]) => void;
  handleDeviceDetailsChange: (details: DeviceDetails) => void;
  handleDeviceHistoryChange: (history: DeviceInstance[]) => void;
  handleDemographicsSave: (updatedFields: PatientRowPatientPatch) => PatientRowSaveResult;
}

export const usePatientRowCommandHandlers = ({
  updateField,
  updateMultiple,
}: PatientRowUpdates): UsePatientRowCommandHandlersResult => {
  const handleTextChange = useCallback(
    (field: PatientRowPatientField) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      updateField(field, e.target.value);
    },
    [updateField]
  );

  const handleCheckboxChange = useCallback(
    (field: PatientRowPatientField) => (e: ChangeEvent<HTMLInputElement>) => {
      updateField(field, e.target.checked);
    },
    [updateField]
  );

  const handleDevicesChange = useCallback(
    (newDevices: string[]) => {
      updateField('devices', newDevices);
    },
    [updateField]
  );

  const handleDeviceDetailsChange = useCallback(
    (details: DeviceDetails) => {
      updateField('deviceDetails', details);
    },
    [updateField]
  );

  const handleDeviceHistoryChange = useCallback(
    (history: DeviceInstance[]) => {
      updateField('deviceInstanceHistory', history);
    },
    [updateField]
  );

  const handleDemographicsSave = useCallback(
    (updatedFields: PatientRowPatientPatch) => {
      return updateMultiple(updatedFields);
    },
    [updateMultiple]
  );

  return {
    handleTextChange,
    handleCheckboxChange,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleDeviceHistoryChange,
    handleDemographicsSave,
  };
};
