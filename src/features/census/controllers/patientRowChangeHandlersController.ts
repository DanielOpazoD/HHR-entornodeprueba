import type {
  ClinicalCribInputChangeHandlers,
  MainPatientInputChangeHandlers,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';

export interface BuildPatientRowChangeHandlersParams {
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

export interface BuildPatientRowChangeHandlersResult {
  mainInputChangeHandlers: MainPatientInputChangeHandlers;
  cribInputChangeHandlers: ClinicalCribInputChangeHandlers;
}

export const buildPatientRowChangeHandlers = ({
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
}: BuildPatientRowChangeHandlersParams): BuildPatientRowChangeHandlersResult => ({
  mainInputChangeHandlers: {
    text: handleTextChange,
    check: handleCheckboxChange,
    devices: handleDevicesChange,
    deviceDetails: handleDeviceDetailsChange,
    deviceHistory: handleDeviceHistoryChange,
    toggleDocType: toggleDocumentType,
    deliveryRoute: handleDeliveryRouteChange,
    multiple: handleDemographicsSave,
  },
  cribInputChangeHandlers: {
    text: handleCribTextChange,
    check: handleCribCheckboxChange,
    devices: handleCribDevicesChange,
    deviceDetails: handleCribDeviceDetailsChange,
    deviceHistory: handleCribDeviceHistoryChange,
    multiple: handleCribDemographicsSave,
  },
});
