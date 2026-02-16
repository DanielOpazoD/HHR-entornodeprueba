import { ChangeEvent, useCallback } from 'react';
import type { DeviceDetails, DeviceInstance, PatientData } from '@/types';
import type { PatientRowInputCommands } from '@/features/census/controllers/patientRowInputHandlersController';

interface UsePatientRowCommandHandlersResult {
  handleTextChange: (
    field: keyof PatientData
  ) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  handleCheckboxChange: (field: keyof PatientData) => (e: ChangeEvent<HTMLInputElement>) => void;
  handleDevicesChange: (newDevices: string[]) => void;
  handleDeviceDetailsChange: (details: DeviceDetails) => void;
  handleDeviceHistoryChange: (history: DeviceInstance[]) => void;
  handleDemographicsSave: (updatedFields: Partial<PatientData>) => void;
}

export const usePatientRowCommandHandlers = (
  commands: PatientRowInputCommands
): UsePatientRowCommandHandlersResult => {
  const handleTextChange = useCallback(
    (field: keyof PatientData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      commands.setTextField(field, e.target.value);
    },
    [commands]
  );

  const handleCheckboxChange = useCallback(
    (field: keyof PatientData) => (e: ChangeEvent<HTMLInputElement>) => {
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
    (updatedFields: Partial<PatientData>) => {
      commands.saveDemographics(updatedFields);
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
