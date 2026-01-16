/**
 * DailyRecord Context Types
 * Type definitions for the DailyRecord context API.
 * Separated for clarity and reusability.
 */

import { DailyRecord, PatientData, CudyrScore, TransferData, PatientFieldValue, CMAData, DischargeData } from '../types';

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
    setRecord: (record: DailyRecord | null | ((prev: DailyRecord | null) => DailyRecord | null)) => void;
    syncStatus: SyncStatus;
    lastSyncTime: Date | null;
    saveAndUpdate: (updatedRecord: DailyRecord) => Promise<void>;
    patchRecord: (partial: DailyRecordPatchLoose) => Promise<void>;
    markLocalChange: () => void;
    refresh: () => void;
}


// ============================================================================
// Patch Types for Type-Safe Firestore Updates
// ============================================================================

/**
 * Represents a dot-notation path for nested object updates.
 * Used by Firestore's updateDoc for partial updates.
 * 
 * Examples:
 * - "beds.R1.patientName"
 * - "beds.R1.cudyr.vitalSigns"
 * - "handoffDayChecklist.escalaBraden"
 */

// Type-safe paths for PatientData fields
type PatientFieldPath = `beds.${string}.${keyof PatientData}`;
type PatientCudyrPath = `beds.${string}.cudyr.${keyof CudyrScore}`;
type PatientClinicalCribPath = `beds.${string}.clinicalCrib.${keyof PatientData}`;
type PatientDeviceDetailsPath = `beds.${string}.deviceDetails.${string}`;

// Type-safe paths for Top-level DailyRecord fields
type TopLevelPath = keyof Pick<DailyRecord,
    | 'date'
    | 'lastUpdated'
    | 'nurses'
    | 'nurseName'
    | 'nursesDayShift'
    | 'nursesNightShift'
    | 'tensDayShift'
    | 'tensNightShift'
    | 'activeExtraBeds'
    | 'discharges'
    | 'transfers'
    | 'cma'
    | 'beds'
    | 'handoffNovedadesDayShift'
    | 'handoffNovedadesNightShift'
    | 'medicalHandoffNovedades'
    | 'medicalHandoffDoctor'
    | 'medicalHandoffSentAt'
>;

// Type-safe paths for Handoff Checklist
type HandoffDayChecklistPath = `handoffDayChecklist.${string}`;
type HandoffNightChecklistPath = `handoffNightChecklist.${string}`;
type HandoffStaffPath = `handoffDayDelivers` | `handoffDayReceives` | `handoffNightDelivers` | `handoffNightReceives`;
type MedicalSignaturePath = `medicalSignature` | `medicalSignature.${string}`;

/**
 * Union of all valid patch paths.
 * This provides compile-time checking for patch keys.
 */
type DailyRecordPatchPath =
    | TopLevelPath
    | PatientFieldPath
    | PatientCudyrPath
    | PatientClinicalCribPath
    | PatientDeviceDetailsPath
    | HandoffDayChecklistPath
    | HandoffNightChecklistPath
    | HandoffStaffPath
    | MedicalSignaturePath;

/**
 * Type-safe patch object for DailyRecord updates.
 * Keys are dot-notation paths, values are the corresponding field types.
 * 
 * Note: We use a looser type for values since TypeScript cannot infer
 * the exact value type from a dynamic string key. Runtime validation
 * should be done by the caller.
 */
export type DailyRecordPatch = {
    [K in DailyRecordPatchPath]?:
    K extends TopLevelPath ? DailyRecord[K] :
    K extends PatientCudyrPath ? number :
    K extends HandoffDayChecklistPath | HandoffNightChecklistPath ? boolean | string :
    K extends HandoffStaffPath ? string[] :
    // For dynamic paths, allow common value types
    PatientFieldValue | PatientData | Record<string, unknown> | string[] | boolean | number | null | undefined;
};

/**
 * Looser patch type for cases where strict typing is impractical.
 * Use DailyRecordPatch when possible for better type safety.
 */
export type DailyRecordPatchLoose = Record<string, PatientFieldValue | PatientData | DischargeData[] | TransferData[] | CMAData[] | Record<string, unknown> | string[] | boolean | number | null | undefined>;

/**
 * The complete API exposed by the DailyRecord context.
 * This is the contract that consumers of the context receive.
 */
export interface DailyRecordContextType {
    // Core State
    record: DailyRecord | null;
    syncStatus: SyncStatus;
    lastSyncTime: Date | null;
    inventory: InventoryStats;

    // Day Management
    createDay: (copyFromPrevious: boolean, specificDate?: string) => void;
    generateDemo: () => void;
    resetDay: () => Promise<void>;
    refresh: () => void;

    // Validation helpers
    validateRecordSchema: (record: DailyRecord) => { isValid: boolean; errors: any[] };
    canMovePatient: (sourceBedId: string, targetBedId: string, record: DailyRecord | null) => { canMove: boolean; reason?: string };
    canDischargePatient: (patient: PatientData) => boolean;

    // Bed Management (from useBedManagement)
    updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
    updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
    updateClinicalCrib: (bedId: string, field: keyof PatientData | 'create' | 'remove', value?: PatientFieldValue) => void;
    updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
    updateClinicalCribCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
    updateCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;
    clearPatient: (bedId: string) => void;
    clearAllBeds: () => void;
    moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;
    toggleBlockBed: (bedId: string, reason?: string) => void;
    updateBlockedReason: (bedId: string, reason: string) => void;
    toggleExtraBed: (bedId: string) => void;

    // Nurse Management (from useNurseManagement)
    updateNurse: (shift: 'day' | 'night', index: number, name: string) => void;

    // TENS Management (from useTensManagement)
    updateTens: (shift: 'day' | 'night', index: number, name: string) => void;

    // Discharge Management (from usePatientDischarges)
    addDischarge: (bedId: string, status: 'Vivo' | 'Fallecido', cribStatus?: 'Vivo' | 'Fallecido', dischargeType?: string, dischargeTypeOther?: string, time?: string, target?: 'mother' | 'baby' | 'both') => void;
    updateDischarge: (id: string, status: 'Vivo' | 'Fallecido', dischargeType?: string, dischargeTypeOther?: string, time?: string) => void;
    deleteDischarge: (id: string) => void;
    undoDischarge: (id: string) => void;

    // Transfer Management (from usePatientTransfers)
    addTransfer: (bedId: string, method: string, center: string, centerOther: string, escort?: string, time?: string) => void;
    updateTransfer: (id: string, updates: Partial<TransferData>) => void;
    deleteTransfer: (id: string) => void;
    undoTransfer: (id: string) => void;

    // CMA / Day Hospitalization (from useCMA)
    addCMA: (data: Omit<CMAData, 'id' | 'timestamp'>) => void;
    deleteCMA: (id: string) => void;
    updateCMA: (id: string, updates: Partial<CMAData>) => void;

    // Handoff Management (from useHandoffManagement)
    updateHandoffChecklist: (shift: 'day' | 'night', field: string, value: boolean | string) => void;
    updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
    updateHandoffStaff: (shift: 'day' | 'night', type: 'delivers' | 'receives' | 'tens', staffList: string[]) => void;
    updateMedicalSignature: (doctorName: string) => Promise<void>;
    updateMedicalHandoffDoctor: (doctorName: string) => Promise<void>;
    markMedicalHandoffAsSent: (doctorName?: string) => Promise<void>;
    sendMedicalHandoff: (templateContent: string, targetGroupId: string) => Promise<void>;
}
