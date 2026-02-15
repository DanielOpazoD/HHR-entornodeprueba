import { ChangeEvent, useCallback, useMemo } from 'react';
import { DeviceDetails, DeviceInstance, PatientData, PatientFieldValue } from '@/types';
import {
  buildDeliveryRoutePatch,
  resolveNextDocumentType,
} from '@/features/census/controllers/patientRowInputController';
import {
  buildPatientFieldUpdater,
  buildPatientMultipleUpdater,
} from '@/features/census/controllers/patientRowInputUpdateController';
import { buildPatientRowInputCommands } from '@/features/census/controllers/patientRowInputHandlersController';

interface UsePatientRowMainInputHandlersParams {
  bedId: string;
  documentType?: PatientData['documentType'];
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
}

interface UsePatientRowCribInputHandlersParams {
  bedId: string;
  updateClinicalCrib: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
}

interface UsePatientRowUpdateAdapterParams {
  bedId: string;
  updateSingle: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updateMany: (bedId: string, fields: Partial<PatientData>) => void;
}

const usePatientRowUpdateAdapter = ({
  bedId,
  updateSingle,
  updateMany,
}: UsePatientRowUpdateAdapterParams) => {
  const updateField = useMemo(
    () => buildPatientFieldUpdater({ bedId, updateSingle }),
    [bedId, updateSingle]
  );

  const updateMultiple = useMemo(
    () => buildPatientMultipleUpdater({ bedId, updateMany }),
    [bedId, updateMany]
  );

  return {
    updateField,
    updateMultiple,
  };
};

export const usePatientRowMainInputHandlers = ({
  bedId,
  documentType,
  updatePatient,
  updatePatientMultiple,
}: UsePatientRowMainInputHandlersParams) => {
  const { updateField, updateMultiple } = usePatientRowUpdateAdapter({
    bedId,
    updateSingle: updatePatient,
    updateMany: updatePatientMultiple,
  });

  const commands = useMemo(
    () => buildPatientRowInputCommands({ updateField, updateMultiple }),
    [updateField, updateMultiple]
  );

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

  const toggleDocumentType = useCallback(() => {
    const nextDocumentType = resolveNextDocumentType(documentType);
    updateField('documentType', nextDocumentType);
  }, [documentType, updateField]);

  const handleDeliveryRouteChange = useCallback(
    (route: 'Vaginal' | 'Cesárea' | undefined, date: string | undefined) => {
      updateMultiple(buildDeliveryRoutePatch(route, date));
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
    toggleDocumentType,
    handleDeliveryRouteChange,
  };
};

export const usePatientRowCribInputHandlers = ({
  bedId,
  updateClinicalCrib,
  updateClinicalCribMultiple,
}: UsePatientRowCribInputHandlersParams) => {
  const { updateField, updateMultiple } = usePatientRowUpdateAdapter({
    bedId,
    updateSingle: updateClinicalCrib,
    updateMany: updateClinicalCribMultiple,
  });

  const commands = useMemo(
    () => buildPatientRowInputCommands({ updateField, updateMultiple }),
    [updateField, updateMultiple]
  );

  const handleCribTextChange = useCallback(
    (field: keyof PatientData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      commands.setTextField(field, e.target.value);
    },
    [commands]
  );

  const handleCribCheckboxChange = useCallback(
    (field: keyof PatientData) => (e: ChangeEvent<HTMLInputElement>) => {
      commands.setCheckboxField(field, e.target.checked);
    },
    [commands]
  );

  const handleCribDevicesChange = useCallback(
    (newDevices: string[]) => {
      commands.setDevices(newDevices);
    },
    [commands]
  );

  const handleCribDeviceDetailsChange = useCallback(
    (details: DeviceDetails) => {
      commands.setDeviceDetails(details);
    },
    [commands]
  );

  const handleCribDeviceHistoryChange = useCallback(
    (history: DeviceInstance[]) => {
      commands.setDeviceHistory(history);
    },
    [commands]
  );

  const handleCribDemographicsSave = useCallback(
    (updatedFields: Partial<PatientData>) => {
      commands.saveDemographics(updatedFields);
    },
    [commands]
  );

  return {
    handleCribTextChange,
    handleCribCheckboxChange,
    handleCribDevicesChange,
    handleCribDeviceDetailsChange,
    handleCribDeviceHistoryChange,
    handleCribDemographicsSave,
  };
};
