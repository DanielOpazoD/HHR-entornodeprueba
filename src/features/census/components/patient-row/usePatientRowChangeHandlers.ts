import { useMemo } from 'react';
import type {
  ClinicalCribInputChangeHandlers,
  MainPatientInputChangeHandlers,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';

interface UsePatientRowChangeHandlersParams {
  handleTextChange: PatientInputChangeHandlers['text'];
  handleCheckboxChange: PatientInputChangeHandlers['check'];
  handleDevicesChange: PatientInputChangeHandlers['devices'];
  handleDeviceDetailsChange: PatientInputChangeHandlers['deviceDetails'];
  handleDeviceHistoryChange: PatientInputChangeHandlers['deviceHistory'];
  handleDemographicsSave: NonNullable<PatientInputChangeHandlers['multiple']>;
  toggleDocumentType: NonNullable<PatientInputChangeHandlers['toggleDocType']>;
  handleDeliveryRouteChange: NonNullable<PatientInputChangeHandlers['deliveryRoute']>;
  handleCribTextChange: ClinicalCribInputChangeHandlers['text'];
  handleCribCheckboxChange: ClinicalCribInputChangeHandlers['check'];
  handleCribDevicesChange: ClinicalCribInputChangeHandlers['devices'];
  handleCribDeviceDetailsChange: ClinicalCribInputChangeHandlers['deviceDetails'];
  handleCribDeviceHistoryChange: ClinicalCribInputChangeHandlers['deviceHistory'];
  handleCribDemographicsSave: ClinicalCribInputChangeHandlers['multiple'];
}

interface UsePatientRowChangeHandlersResult {
  mainInputChangeHandlers: MainPatientInputChangeHandlers;
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

  const mainInputChangeHandlers = useMemo<MainPatientInputChangeHandlers>(
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
