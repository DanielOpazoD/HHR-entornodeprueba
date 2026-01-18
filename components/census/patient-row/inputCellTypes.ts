/**
 * Shared types for patient input cell components
 */

import { PatientData, DeviceDetails } from '../../../types';

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
}

/**
 * Handler for text field changes - adapts debounced value to event-based API
 */
export type DebouncedTextHandler = (field: keyof PatientData) => (value: string) => void;

/**
 * Handler for native event-based changes (selects, etc.)
 */
export type EventTextHandler = (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

/**
 * Handler for checkbox changes
 */
export type CheckHandler = (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => void;

/**
 * Props for components that need multiple field updates atomically
 */
export interface MultipleUpdateProps {
    onMultipleUpdate?: (fields: Partial<PatientData>) => void;
}

/**
 * Props for device-related components
 */
export interface DeviceHandlers {
    onDevicesChange: (newDevices: string[]) => void;
    onDeviceDetailsChange: (details: DeviceDetails) => void;
}
