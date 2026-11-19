/**
 * Type definitions for values used in patient data updates and other operations.
 * These replace `any` types throughout the codebase for better type safety.
 */

import { ClinicalEvent } from './domain/clinicalEvents';
import type { CudyrScore } from './domain/cudyr';
import type { DeviceDetails, DeviceInstance } from './domain/devices';
import type { FhirResource } from './domain/fhir';
import type { PatientData, MedicalHandoffAudit, MedicalHandoffEntry } from './domain/patient';
import type { PatientStatus, Specialty } from './domain/patientClassification';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

// ============================================================================
// Patient Data Field Values
// ============================================================================

/**
 * All possible values that can be assigned to PatientData fields
 */
export type PatientFieldValue =
  | string
  | number
  | boolean
  | string[]
  | undefined
  | PatientData
  | CudyrScore
  | DeviceDetails
  | PatientStatus
  | Specialty
  | ClinicalEvent[]
  | DeviceInstance[]
  | MedicalHandoffAudit
  | MedicalHandoffEntry[]
  | UpcChecklistRecord
  | FhirResource;

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Standard error type for catch blocks - use with type narrowing
 */
export type CaughtError = unknown;

/**
 * Helper to extract error message from unknown error
 */
export function getErrorMessage(error: CaughtError): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'An unknown error occurred';
}

// ============================================================================
// Component Props
// ============================================================================

// ============================================================================
// Data Utilities (Re-exported for backwards compatibility)
// New code should import from '@/utils'
// ============================================================================

export { escapeCsvValue } from '@/utils/csvUtils';
