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

// Repository
import {
    getPreviousDay,
    initializeDay,
    save,
    deleteDay
} from '../services/repositories/DailyRecordRepository';
import { generateDemoRecord } from '../services/utils/demoDataGenerator';

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
    // Day Lifecycle
    // ========================================================================
    /**
     * Creates a new daily record for the current date.
     * Optionally copies patient data from the previous day.
     * 
     * @param copyFromPrevious - If true, attempts to clone the previous day's patient census
     * @returns Promise that resolves when the day is initialized
     * 
     * @example
     * ```typescript
     * await createDay(true); // Copy from previous day
     * await createDay(true, '2025-12-25'); // Copy from specific date
     * ```
     */
    const createDay = useCallback(async (copyFromPrevious: boolean, specificDate?: string) => {
        let prevDate: string | undefined = undefined;

        if (copyFromPrevious) {
            if (specificDate) {
                // Use the specific date provided
                prevDate = specificDate;
            } else {
                // Fall back to finding the previous day
                const prevRecord = await getPreviousDay(currentDateString);
                if (prevRecord) {
                    prevDate = prevRecord.date;
                } else {
                    warning("No se encontró registro anterior", "No hay datos del día previo para copiar.");
                    return;
                }
            }
        }

        const newRecord = await initializeDay(currentDateString, prevDate);
        markLocalChange();
        setRecord(newRecord);

        const sourceMsg = prevDate ? `Copiado desde ${prevDate}` : 'Registro en blanco';
        success('Día creado', sourceMsg);

        // Audit Log
        logDailyRecordCreated(currentDateString, copyFromPrevious ? (specificDate || 'previous_day') : 'blank');
    }, [currentDateString, warning, success, markLocalChange, setRecord]);

    const generateDemo = useCallback(async () => {
        const demoRecord = generateDemoRecord(currentDateString);
        await save(demoRecord);
        markLocalChange();
        setRecord({ ...demoRecord });
    }, [currentDateString, markLocalChange, setRecord]);

    /**
     * Resets the current day by deleting its record from the repository.
     * 
     * @returns Promise that resolves when the record is deleted
     */
    const resetDay = useCallback(async () => {
        await deleteDay(currentDateString);
        setRecord(null);
        success('Registro eliminado', 'El registro del día ha sido eliminado. Puede crear uno nuevo.');

        // Audit Log
        logDailyRecordDeleted(currentDateString);
    }, [currentDateString, setRecord, success]);

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

        // Day Lifecycle
        createDay,
        generateDemo,
        resetDay,
        refresh,

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
        record, syncStatus, lastSyncTime,
        createDay, generateDemo, resetDay, refresh,
        bedManagement, nurseManagement, tensManagement,
        dischargeManagement, transferManagement, cmaManagement,
        handoffManagement
    ]);
};
