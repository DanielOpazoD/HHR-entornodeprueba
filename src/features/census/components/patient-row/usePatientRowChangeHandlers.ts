import { useMemo } from 'react';
import {
  buildPatientRowChangeHandlers,
  type BuildPatientRowChangeHandlersParams,
  type BuildPatientRowChangeHandlersResult,
} from '@/features/census/controllers/patientRowChangeHandlersController';

type UsePatientRowChangeHandlersParams = BuildPatientRowChangeHandlersParams;
type UsePatientRowChangeHandlersResult = BuildPatientRowChangeHandlersResult;

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
  return useMemo(
    () =>
      buildPatientRowChangeHandlers({
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
      }),
    [
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
    ]
  );
};
