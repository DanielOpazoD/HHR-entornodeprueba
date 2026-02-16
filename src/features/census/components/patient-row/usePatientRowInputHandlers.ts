import { useCallback, useMemo } from 'react';
import { PatientData, PatientFieldValue } from '@/types';
import {
  buildDeliveryRoutePatch,
  resolveNextDocumentType,
} from '@/features/census/controllers/patientRowInputController';
import {
  buildPatientFieldUpdater,
  buildPatientMultipleUpdater,
} from '@/features/census/controllers/patientRowInputUpdateController';
import { buildPatientRowInputCommands } from '@/features/census/controllers/patientRowInputHandlersController';
import { usePatientRowCommandHandlers } from '@/features/census/components/patient-row/usePatientRowCommandHandlers';

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
  const commandHandlers = usePatientRowCommandHandlers(commands);

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
    ...commandHandlers,
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
  const commandHandlers = usePatientRowCommandHandlers(commands);

  return {
    handleCribTextChange: commandHandlers.handleTextChange,
    handleCribCheckboxChange: commandHandlers.handleCheckboxChange,
    handleCribDevicesChange: commandHandlers.handleDevicesChange,
    handleCribDeviceDetailsChange: commandHandlers.handleDeviceDetailsChange,
    handleCribDeviceHistoryChange: commandHandlers.handleDeviceHistoryChange,
    handleCribDemographicsSave: commandHandlers.handleDemographicsSave,
  };
};
