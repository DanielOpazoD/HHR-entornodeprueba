/**
 * Shared types for patient input cell components
 */

import type { ChangeEvent } from 'react';
import type {
  CesareanLabor,
  DeliveryRoute,
} from '@/features/census/contracts/censusObstetricContracts';
import type {
  PatientData,
  PatientRowPatientField,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type { PatientDeviceCallbacks } from './patientRowDeviceContracts';

/**
 * Common props shared by all input cell components
 */
export interface BaseCellProps {
  /** Patient data object */
  data: PatientData;
  /** Whether this is a sub-row (clinical crib) */
  isSubRow?: boolean;
  /** Whether the row is empty (no patient) */
  isEmpty?: boolean;
  /** Whether the field is read-only */
  readOnly?: boolean;
  /** User-facing reason shown when a field is temporarily locked */
  readOnlyReason?: string;
  /** Soft pause shown after Firebase updated this field group. */
  clinicalPause?: ClinicalFieldFreshnessPause;
}

export interface ClinicalFieldFreshnessPause {
  isPaused: boolean;
  message: string;
  token?: string;
  onAcknowledge: () => void;
}

/**
 * Handler for text field changes - adapts debounced value to event-based API
 */
export type DebouncedTextHandler = (field: PatientRowPatientField) => (value: string) => void;

/**
 * Handler for native event-based changes (selects, etc.)
 */
export type EventTextHandler = (
  field: PatientRowPatientField
) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

/**
 * Handler for checkbox changes
 */
export type CheckHandler = (
  field: PatientRowPatientField
) => (e: ChangeEvent<HTMLInputElement>) => void;

/**
 * Props for components that need multiple field updates atomically
 */
export interface MultipleUpdateProps {
  onMultipleUpdate?: (fields: PatientRowPatientPatch) => void;
}

/**
 * Props for device-related components
 */
export type DeviceHandlers = PatientDeviceCallbacks;

export interface PatientInputChangeHandlers {
  text: EventTextHandler;
  check: CheckHandler;
  devices: (newDevices: string[]) => void;
  deviceDetails: (details: DeviceDetails) => void;
  deviceHistory: (history: DeviceInstance[]) => void;
  toggleDocType?: () => void;
  deliveryRoute?: (
    route: DeliveryRoute | undefined,
    date: string | undefined,
    cesareanLabor: CesareanLabor | undefined
  ) => void;
  multiple?: (fields: PatientRowPatientPatch) => void;
}

export interface MainPatientInputChangeHandlers extends Omit<
  PatientInputChangeHandlers,
  'toggleDocType' | 'deliveryRoute' | 'multiple'
> {
  toggleDocType: () => void;
  deliveryRoute: (
    route: DeliveryRoute | undefined,
    date: string | undefined,
    cesareanLabor: CesareanLabor | undefined
  ) => void;
  multiple: (fields: PatientRowPatientPatch) => void;
}

export interface ClinicalCribInputChangeHandlers extends Omit<
  PatientInputChangeHandlers,
  'toggleDocType' | 'deliveryRoute'
> {
  multiple: (fields: PatientRowPatientPatch) => void;
}
