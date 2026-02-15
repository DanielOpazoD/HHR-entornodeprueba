import { useMemo } from 'react';
import type {
  ClinicalCribInputChangeHandlers,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';

interface UsePatientRowChangeHandlersParams {
  handleTextChange: PatientInputChangeHandlers['text'];
  handleCheckboxChange: PatientInputChangeHandlers['check'];
  handleDevicesChange: PatientInputChangeHandlers['devices'];
  handleDeviceDetailsChange: PatientInputChangeHandlers['deviceDetails'];
  handleDeviceHistoryChange: PatientInputChangeHandlers['deviceHistory'];
  handleDemographicsSave: PatientInputChangeHandlers['multiple'];
  toggleDocumentType: PatientInputChangeHandlers['toggleDocType'];
  handleDeliveryRouteChange: PatientInputChangeHandlers['deliveryRoute'];
  handleCribTextChange: ClinicalCribInputChangeHandlers['text'];
  handleCribCheckboxChange: ClinicalCribInputChangeHandlers['check'];
  handleCribDevicesChange: ClinicalCribInputChangeHandlers['devices'];
  handleCribDeviceDetailsChange: ClinicalCribInputChangeHandlers['deviceDetails'];
  handleCribDeviceHistoryChange: ClinicalCribInputChangeHandlers['deviceHistory'];
  handleCribDemographicsSave: ClinicalCribInputChangeHandlers['multiple'];
}

interface UsePatientRowChangeHandlersResult {
  mainInputChangeHandlers: PatientInputChangeHandlers;
  cribInputChangeHandlers: ClinicalCribInputChangeHandlers;
}

export const usePatientRowChangeHandlers = ({
  handleTextChange,
  handleCheckboxChange,
  handleDevicesChange,
  handleDeviceDetailsChange,
  handleDeviceHistoryChange,
  handleDemographicsSave,
  toggleDocumentType,
  handleDeliveryRouteChange,
  handleCribTextChange,
  handleCribCheckboxChange,
  handleCribDevicesChange,
  handleCribDeviceDetailsChange,
  handleCribDeviceHistoryChange,
  handleCribDemographicsSave,
}: UsePatientRowChangeHandlersParams): UsePatientRowChangeHandlersResult => {
  const cribInputChangeHandlers = useMemo<ClinicalCribInputChangeHandlers>(
    () => ({
      text: handleCribTextChange,
      check: handleCribCheckboxChange,
      devices: handleCribDevicesChange,
      deviceDetails: handleCribDeviceDetailsChange,
      deviceHistory: handleCribDeviceHistoryChange,
      multiple: handleCribDemographicsSave,
    }),
    [
      handleCribCheckboxChange,
      handleCribDemographicsSave,
      handleCribDeviceDetailsChange,
      handleCribDeviceHistoryChange,
      handleCribDevicesChange,
      handleCribTextChange,
    ]
  );

  const mainInputChangeHandlers = useMemo<PatientInputChangeHandlers>(
    () => ({
      text: handleTextChange,
      check: handleCheckboxChange,
      devices: handleDevicesChange,
      deviceDetails: handleDeviceDetailsChange,
      deviceHistory: handleDeviceHistoryChange,
      toggleDocType: toggleDocumentType,
      deliveryRoute: handleDeliveryRouteChange,
      multiple: handleDemographicsSave,
    }),
    [
      handleCheckboxChange,
      handleDeliveryRouteChange,
      handleDemographicsSave,
      handleDeviceDetailsChange,
      handleDeviceHistoryChange,
      handleDevicesChange,
      handleTextChange,
      toggleDocumentType,
    ]
  );

  return {
    mainInputChangeHandlers,
    cribInputChangeHandlers,
  };
};
