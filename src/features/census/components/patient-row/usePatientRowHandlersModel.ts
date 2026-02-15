import { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';
import {
  usePatientRowCribInputHandlers,
  usePatientRowMainInputHandlers,
} from '@/features/census/components/patient-row/usePatientRowInputHandlers';
import type { PatientData, PatientFieldValue } from '@/types';

interface UsePatientRowHandlersModelParams {
  bedId: string;
  documentType?: PatientData['documentType'];
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  updateClinicalCrib: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
}

export const usePatientRowHandlersModel = ({
  bedId,
  documentType,
  updatePatient,
  updatePatientMultiple,
  updateClinicalCrib,
  updateClinicalCribMultiple,
}: UsePatientRowHandlersModelParams) => {
  const mainHandlers = usePatientRowMainInputHandlers({
    bedId,
    documentType,
    updatePatient,
    updatePatientMultiple,
  });

  const cribHandlers = usePatientRowCribInputHandlers({
    bedId,
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
    },
  };
};
