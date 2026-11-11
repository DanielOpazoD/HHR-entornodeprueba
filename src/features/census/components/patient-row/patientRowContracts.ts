import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type { PatientRowPatientPatch } from '@/features/census/components/patient-row/patientRowDataContracts';

export type {
  PatientRowDeliveryPatch,
  PatientRowPatientDocumentType,
  PatientRowPatientField,
  PatientRowPatientPatch,
  PatientRowStateContract,
} from '@/features/census/components/patient-row/patientRowDataContracts';
export type {
  PatientBedConfigProps,
  PatientInputCellsProps,
  PatientMainRowActionCellProps,
  PatientMainRowBedTypeCellProps,
  PatientMainRowBlockedCellProps,
  PatientMainRowViewProps,
  PatientRowModalsProps,
  PatientRowProps,
  PatientSubRowViewProps,
} from '@/features/census/components/patient-row/patientRowViewContracts';
export type {
  MaybePromiseVoid,
  RowMenuAlign,
} from '@/features/census/components/patient-row/patientRowUiContracts';
export type { PatientBedConfigCallbacks } from '@/features/census/components/patient-row/patientRowBedConfigContracts';
export type {
  PatientActionMenuActionFilter,
  PatientActionMenuAvailability,
  PatientActionMenuBinding,
  PatientActionMenuCallbacks,
  PatientActionMenuIndicators,
} from '@/features/census/components/patient-row/patientRowActionContracts';

export interface PatientDeviceCallbacks {
  onDevicesChange: (devices: string[]) => void;
  onDeviceDetailsChange: (details: DeviceDetails) => void;
  onDeviceHistoryChange: (history: DeviceInstance[]) => void;
  onDeviceBundleChange?: (fields: PatientRowPatientPatch) => void;
}
