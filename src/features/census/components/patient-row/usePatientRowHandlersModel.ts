import { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import type {
  PatientData,
  PatientRowPatientDocumentType,
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { PatientFieldValue } from '@/types/valueTypes';

interface UsePatientRowHandlersModelParams {
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

export const usePatientRowHandlersModel = ({
  bedId,
  currentDateString,
  data,
  documentType,
  updatePatient,
  updatePatientMultiple,
  clearPatient,
  updateClinicalCrib,
  updateClinicalCribMultiple,
}: UsePatientRowHandlersModelParams) => {
  const mainHandlers = usePatientRowMainInputHandlers({
    bedId,
    currentDateString,
    data,
    documentType,
    updatePatient,
    updatePatientMultiple,
  });

  const cribHandlers = usePatientRowCribInputHandlers({
    bedId,
    currentDateString,
    data: data.clinicalCrib,
    updateClinicalCrib,
    updateClinicalCribMultiple,
  });

  const handlers = usePatientRowChangeHandlers({
    handleTextChange: mainHandlers.handleTextChange,
    handleCheckboxChange: mainHandlers.handleCheckboxChange,
    handleDevicesChange: mainHandlers.handleDevicesChange,
    handleDeviceDetailsChange: mainHandlers.handleDeviceDetailsChange,
    handleDeviceHistoryChange: mainHandlers.handleDeviceHistoryChange,
    handleDemographicsSave: mainHandlers.handleDemographicsSave,
    toggleDocumentType: mainHandlers.toggleDocumentType,
    handleDeliveryRouteChange: mainHandlers.handleDeliveryRouteChange,
    handleCribTextChange: cribHandlers.handleCribTextChange,
    handleCribCheckboxChange: cribHandlers.handleCribCheckboxChange,
    handleCribDevicesChange: cribHandlers.handleCribDevicesChange,
    handleCribDeviceDetailsChange: cribHandlers.handleCribDeviceDetailsChange,
    handleCribDeviceHistoryChange: cribHandlers.handleCribDeviceHistoryChange,
    handleCribDemographicsSave: cribHandlers.handleCribDemographicsSave,
  });

  return {
    handlers,
    modalSavers: {
      onSaveDemographics: mainHandlers.handleDemographicsSave,
      onSaveCribDemographics: cribHandlers.handleCribDemographicsSave,
      onRevertEmptyDemographics: () => {
        void clearPatient(bedId);
      },
    },
  };
};
