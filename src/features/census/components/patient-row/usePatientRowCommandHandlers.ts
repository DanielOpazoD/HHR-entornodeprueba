import type { PatientRowSaveResult } from './inputCellTypes';
import { ChangeEvent, useCallback, useMemo } from 'react';
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
  const updates = useMemo(() => ({ updateField, updateMultiple }), [updateField, updateMultiple]);
  const handleTextChange = useCallback(
    (field: PatientRowPatientField) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      updates.updateField(field, e.target.value);
    },
    [updates]
  );

  const handleCheckboxChange = useCallback(
    (field: PatientRowPatientField) => (e: ChangeEvent<HTMLInputElement>) => {
      updates.updateField(field, e.target.checked);
    },
    [updates]
  );

  const handleDevicesChange = useCallback(
    (newDevices: string[]) => {
      updates.updateField('devices', newDevices);
    },
    [updates]
  );

  const handleDeviceDetailsChange = useCallback(
    (details: DeviceDetails) => {
      updates.updateField('deviceDetails', details);
    },
    [updates]
  );

  const handleDeviceHistoryChange = useCallback(
    (history: DeviceInstance[]) => {
      updates.updateField('deviceInstanceHistory', history);
    },
    [updates]
  );

  const handleDemographicsSave = useCallback(
    (updatedFields: PatientRowPatientPatch) => {
      return updates.updateMultiple(updatedFields);
    },
    [updates]
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
