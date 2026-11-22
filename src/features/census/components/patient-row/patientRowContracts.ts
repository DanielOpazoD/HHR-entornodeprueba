import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type { PatientData } from '@/types/domain/patient';

/**
 * Owner contract for the patient-row subfeature.
 *
 * Derived row shapes use the patient domain type from its canonical home.
 */
export type PatientRowPatientPatch = Partial<PatientData>;
export type PatientRowPatientField = keyof PatientData;
export type PatientRowPatientDocumentType = PatientData['documentType'];
export type PatientRowDeliveryPatch = Pick<
  PatientData,
  'deliveryRoute' | 'deliveryDate' | 'deliveryCesareanLabor'
>;
export type PatientRowStateContract = Pick<
  PatientData,
  'bedMode' | 'hasCompanionCrib' | 'clinicalCrib' | 'isBlocked' | 'patientName'
>;

export type {
  PatientBedConfigProps,
  PatientInputCellsProps,
  PatientMainRowBlockedCellProps,
} from './patientRowInputViewContracts';
export type {
  PatientMainRowActionCellProps,
  PatientMainRowViewProps,
  PatientSubRowViewProps,
} from './patientRowMainViewContracts';
export type { PatientRowModalsProps, PatientRowProps } from './patientRowShellViewContracts';
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
