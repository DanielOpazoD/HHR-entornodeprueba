/**
 * DailyRecord Context Types
 * Type definitions for the DailyRecord context API.
 * Separated for clarity and reusability.
 */

import {
  DailyRecord,
  PatientData,
  CudyrScore,
  PatientFieldValue,
  CMAData,
  DailyRecordPatch,
} from '@/types';
import type { PatientMovementActions } from '@/features/census/domain/movements/contracts';
export type { DailyRecordPatch };

// ============================================================================
// Sync Types
// ============================================================================

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface InventoryStats {
  occupiedCount: number;
  blockedCount: number;
  availableCount: number;
  occupancyRate: number;
  occupiedBeds: string[];
  freeBeds: string[];
  blockedBeds: string[];
  isFull: boolean;
}

export interface UseDailyRecordSyncResult {
  record: DailyRecord | null;
  setRecord: (
    record: DailyRecord | null | ((prev: DailyRecord | null) => DailyRecord | null)
  ) => void;
  syncStatus: SyncStatus;
  lastSyncTime: Date | null;
  saveAndUpdate: (updatedRecord: DailyRecord) => Promise<void>;
  patchRecord: (partial: DailyRecordPatch) => Promise<void>;
  markLocalChange: () => void;
  refresh: () => void;

  // Day Lifecycle (Consolidated)
  createDay: (copyFromPrevious: boolean, specificDate?: string) => Promise<void>;
  resetDay: () => Promise<void>;
  generateDemo: () => Promise<void>;
}

// DailyRecordPatch and related types have been moved to types/core.ts

/**
 * Data-only part of the context.
 * Changes to these fields will trigger re-renders in subscribing components.
 */
export interface DailyRecordDataContextType {
  record: DailyRecord | null;
  syncStatus: SyncStatus;
  lastSyncTime: Date | null;
  inventory: InventoryStats;
  stabilityRules: import('@/hooks/useStabilityRules').StabilityRules;
}

/**
 * Actions-only part of the context.
 * These functions are generally stable (referentially consistent)
 * and won't trigger re-renders when data changes.
 */
export interface DailyRecordActionsContextType extends PatientMovementActions {
  // Day Management
  createDay: (copyFromPrevious: boolean, specificDate?: string) => void;
  generateDemo: () => void;
  resetDay: () => Promise<void>;
  refresh: () => void;

  // Validation helpers
  validateRecordSchema: (record: DailyRecord) => {
    isValid: boolean;
    errors: import('zod').ZodIssue[];
  };
  canMovePatient: (
    sourceBedId: string,
    targetBedId: string,
    record: DailyRecord | null
  ) => { canMove: boolean; reason?: string };
  canDischargePatient: (patient: PatientData) => boolean;

  // Bed Management (from useBedManagement)
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  updateClinicalCrib: (
    bedId: string,
    field: keyof PatientData | 'create' | 'remove',
    value?: PatientFieldValue
  ) => void;
  updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  updateClinicalCribCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
  updateClinicalCribCudyrMultiple?: (
    bedId: string,
    fields: Partial<Record<keyof CudyrScore, number>>
  ) => void;
  updateCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
  updateCudyrMultiple?: (bedId: string, fields: Partial<Record<keyof CudyrScore, number>>) => void;
  clearPatient: (bedId: string) => void;
  clearAllBeds: () => void;
  moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;
  toggleBlockBed: (bedId: string, reason?: string) => void;
  updateBlockedReason: (bedId: string, reason: string) => void;
  toggleExtraBed: (bedId: string) => void;
  toggleBedType: (bedId: string) => void;
  copyPatientToDate: (bedId: string, targetDate: string, targetBedId?: string) => Promise<void>;

  // Nurse Management (from useNurseManagement)
  updateNurse: (shift: 'day' | 'night', index: number, name: string) => void;

  // TENS Management (from useTensManagement)
  updateTens: (shift: 'day' | 'night', index: number, name: string) => void;

  // CMA / Day Hospitalization (from useCMA)
  addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
  deleteCMA: (id: string) => void;
  updateCMA: (id: string, updates: Partial<CMAData>) => void;

  // Handoff Management (from useHandoffManagement)
  updateHandoffChecklist: (shift: 'day' | 'night', field: string, value: boolean | string) => void;
  updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
  updateHandoffStaff: (
    shift: 'day' | 'night',
    type: 'delivers' | 'receives' | 'tens',
    staffList: string[]
  ) => void;
  updateMedicalSignature: (doctorName: string) => Promise<void>;
  updateMedicalHandoffDoctor: (doctorName: string) => Promise<void>;
  markMedicalHandoffAsSent: (doctorName?: string) => Promise<void>;
  sendMedicalHandoff: (templateContent: string, targetGroupId: string) => Promise<void>;
}

/**
 * Union type for compatibility with legacy components
 * that still use the unified context.
 */
export type DailyRecordContextType = DailyRecordDataContextType & DailyRecordActionsContextType;
