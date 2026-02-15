/**
 * Types Index
 * Centralized exports for all type definitions
 *
 * Usage: import { PatientData, DailyRecord, ... } from './types';
 */

// Core domain types (enums, interfaces)
export {
  // Enums
  BedType,
  Specialty,
  PatientStatus,

  // Interfaces
  type BedDefinition,
  type CudyrScore,
  type ClinicalEvent,
  type PatientData,
  type MasterPatient,
  type HospitalizationEvent,
  type DeviceInfo,
  type DeviceDetails,
  type DeviceInstance,
  type DischargeData,
  type TransferData,
  type CMAData,
  type DailyRecord,
  type Statistics,
  type DischargeType,
  type ShiftType,
  type FhirResource,
  type DailyRecordPatch,
  type DailyRecordPatchPath,
  type ProfessionalSpecialty,
  type ProfessionalCatalogItem,
} from './core';

// Value types and utilities
export {
  // Field value types for type-safe updates
  type PatientFieldValue,
  type PatientStringField,
  type PatientBooleanField,
  type PatientArrayField,
  type PatientEnumField,
  type PatientObjectField,

  // Error handling
  type CaughtError,
  getErrorMessage,

  // Component types
  type IconComponent,

  // Utility functions
  randomItem,
  escapeCsvValue,
} from './valueTypes';

// Audit logging types
export { type AuditLogEntry, type AuditAction, maskRut } from './audit';

// WhatsApp integration types
export {
  type WeeklyShift,
  type ShiftStaffMember,
  type HandoffWhatsAppStatus,
  type HandoffAutoSend,
  type WhatsAppConfig,
  type WhatsAppLog,
} from './whatsapp';

// Auth types
export { type AuthUser, type UserRole } from './auth';
