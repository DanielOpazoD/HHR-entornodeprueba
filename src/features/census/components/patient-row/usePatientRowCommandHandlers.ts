import type { PatientRowSaveResult } from './inputCellTypes';
import { ChangeEvent, useCallback } from 'react';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type {
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientRowInputCommands } from '@/features/census/controllers/patientRowInputHandlersController';

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

export const usePatientRowCommandHandlers = (
  commands: PatientRowInputCommands
): UsePatientRowCommandHandlersResult => {
  const handleTextChange = useCallback(
    (field: PatientRowPatientField) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      commands.setTextField(field, e.target.value);
    },
    [commands]
  );

  const handleCheckboxChange = useCallback(
    (field: PatientRowPatientField) => (e: ChangeEvent<HTMLInputElement>) => {
      commands.setCheckboxField(field, e.target.checked);
    },
    [commands]
  );

  const handleDevicesChange = useCallback(
    (newDevices: string[]) => {
      commands.setDevices(newDevices);
    },
    [commands]
  );

  const handleDeviceDetailsChange = useCallback(
    (details: DeviceDetails) => {
      commands.setDeviceDetails(details);
    },
    [commands]
  );

  const handleDeviceHistoryChange = useCallback(
    (history: DeviceInstance[]) => {
      commands.setDeviceHistory(history);
    },
    [commands]
  );

  const handleDemographicsSave = useCallback(
    (updatedFields: PatientRowPatientPatch) => {
      return commands.saveDemographics(updatedFields);
    },
    [commands]
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
