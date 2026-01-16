/**
 * useDailyRecord Hook
 * Central orchestrator for daily record management.
 * 
 * This hook composes smaller specialized hooks:
 * - useDailyRecordSync: Real-time sync with Firebase
 * - useBedManagement: Patient bed operations
 * - usePatientDischarges: Discharge workflow
 * - usePatientTransfers: Transfer workflow
 * - useNurseManagement: Nurse assignments
 * - useCMA: Day hospitalization records
 */

import { useCallback, useMemo } from 'react';
import { useNotification } from '../context/UIContext';
import {
    logDailyRecordCreated,
    logDailyRecordDeleted
} from '../services/admin/auditService';

import { generateDemoRecord } from '../services/utils/demoDataGenerator';
import { DailyRecord } from '../types';

// Sub-hooks
import { usePersistence } from './usePersistence';
import { useInventory } from './useInventory';
import { useValidation } from './useValidation';

// Sync hooks

import { useDailyRecordSyncQuery } from './useDailyRecordSyncQuery';

// Domain hooks
import { useBedManagement } from './useBedManagement';
import { usePatientDischarges } from './usePatientDischarges';
import { usePatientTransfers } from './usePatientTransfers';
import { useNurseManagement, useTensManagement } from './useNurseManagement';
import { useCMA } from './useCMA';
import { useHandoffManagement } from './useHandoffManagement';

// Types
import { DailyRecordContextType } from './useDailyRecordTypes';

// Re-export types for consumers
export type { DailyRecordContextType } from './useDailyRecordTypes';
export type { SyncStatus } from './useDailyRecordTypes';

/**
 * Main hook for daily record management.
 * Orchestrates sync, persistence, and domain operations.
 */
export const useDailyRecord = (
    currentDateString: string,
    isOfflineMode: boolean = false,
    isFirebaseConnected: boolean = false
): DailyRecordContextType => {
    const { success, warning } = useNotification();

    // ========================================================================
    // Sync & State Management
    // ========================================================================
    const {
        record,
        setRecord,
        syncStatus,
        lastSyncTime,
        saveAndUpdate,
        markLocalChange,
        refresh,
        patchRecord
    } = useDailyRecordSyncQuery(currentDateString, isOfflineMode, isFirebaseConnected);

    // ========================================================================
    // Orchestrated Sub-hooks
    // ========================================================================
    const { createDay, generateDemo, resetDay } = usePersistence({
        currentDateString,
        markLocalChange,
        setRecord
    });

    const inventory = useInventory(record);
    const { validateRecordSchema, canMovePatient, canDischargePatient } = useValidation();

    // ========================================================================
    // Domain Hooks Composition
    // ========================================================================
    const bedManagement = useBedManagement(record, saveAndUpdate, patchRecord);
    const dischargeManagement = usePatientDischarges(record, saveAndUpdate);
    const transferManagement = usePatientTransfers(record, saveAndUpdate);
    const nurseManagement = useNurseManagement(record, patchRecord);
    const tensManagement = useTensManagement(record, patchRecord);
    const cmaManagement = useCMA(record, saveAndUpdate);
    const handoffManagement = useHandoffManagement(record, saveAndUpdate, patchRecord);

    // ========================================================================
    // Public API (memoized to prevent unnecessary re-renders)
    // ========================================================================
    return useMemo(() => ({
        // Core State
        record,
        syncStatus,
        lastSyncTime,
        inventory,

        // Day Lifecycle
        createDay,
        generateDemo,
        resetDay,
        refresh,

        // Validation helpers
        validateRecordSchema,
        canMovePatient,
        canDischargePatient,

        // Bed Management
        updatePatient: bedManagement.updatePatient,
        updatePatientMultiple: bedManagement.updatePatientMultiple,
        updateClinicalCrib: bedManagement.updateClinicalCrib,
        updateClinicalCribMultiple: bedManagement.updateClinicalCribMultiple,
        updateClinicalCribCudyr: bedManagement.updateClinicalCribCudyr,
        updateCudyr: bedManagement.updateCudyr,
        clearPatient: bedManagement.clearPatient,
        clearAllBeds: bedManagement.clearAllBeds,
        moveOrCopyPatient: bedManagement.moveOrCopyPatient,
        toggleBlockBed: bedManagement.toggleBlockBed,
        updateBlockedReason: bedManagement.updateBlockedReason,
        toggleExtraBed: bedManagement.toggleExtraBed,

        // Nurse Management
        updateNurse: nurseManagement.updateNurse,

        // TENS Management
        updateTens: tensManagement.updateTens,

        // Discharges
        addDischarge: dischargeManagement.addDischarge,
        updateDischarge: dischargeManagement.updateDischarge,
        deleteDischarge: dischargeManagement.deleteDischarge,
        undoDischarge: dischargeManagement.undoDischarge,

        // Transfers
        addTransfer: transferManagement.addTransfer,
        updateTransfer: transferManagement.updateTransfer,
        deleteTransfer: transferManagement.deleteTransfer,
        undoTransfer: transferManagement.undoTransfer,

        // CMA (Day Hospitalization)
        addCMA: cmaManagement.addCMA,
        deleteCMA: cmaManagement.deleteCMA,
        updateCMA: cmaManagement.updateCMA,

        // Handoff Management
        updateHandoffChecklist: handoffManagement.updateHandoffChecklist,
        updateHandoffNovedades: handoffManagement.updateHandoffNovedades,
        updateHandoffStaff: handoffManagement.updateHandoffStaff,
        updateMedicalSignature: handoffManagement.updateMedicalSignature,
        updateMedicalHandoffDoctor: handoffManagement.updateMedicalHandoffDoctor,
        markMedicalHandoffAsSent: handoffManagement.markMedicalHandoffAsSent,
        sendMedicalHandoff: handoffManagement.sendMedicalHandoff
    }), [
        record, syncStatus, lastSyncTime, inventory,
        createDay, generateDemo, resetDay, refresh,
        validateRecordSchema, canMovePatient, canDischargePatient,
        bedManagement, nurseManagement, tensManagement,
        dischargeManagement, transferManagement, cmaManagement,
        handoffManagement
    ]);
};
