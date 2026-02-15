import { useMemo, useCallback, useRef, useEffect } from 'react';

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
import { useStabilityRules } from './useStabilityRules';
import { useRepositories } from '@/services/RepositoryContext';

// Types
import { DailyRecordContextType } from './useDailyRecordTypes';

/**
 * Main hook for daily record management.
 * Orchestrates sync, persistence, and domain operations.
 */
export const useDailyRecord = (
  currentDateString: string,
  isOfflineMode: boolean = false,
  isFirebaseConnected: boolean = false
): DailyRecordContextType => {
  const { dailyRecord } = useRepositories();

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
    patchRecord,
  } = useDailyRecordSyncQuery(currentDateString, isOfflineMode, isFirebaseConnected);

  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  // ========================================================================
  // Orchestrated Sub-hooks
  // ========================================================================
  const { createDay, generateDemo, resetDay } = usePersistence({
    currentDateString,
    markLocalChange,
    setRecord,
  });

  const inventory = useInventory(record);
  const stabilityRules = useStabilityRules(record);
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
  // Cross-date Copy
  // ========================================================================
  const copyPatientToDate = useCallback(
    async (bedId: string, targetDate: string, targetBedId?: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const sourcePatient = currentRecord.beds[bedId];
      if (!sourcePatient || !sourcePatient.patientName) return;

      const finalTargetBedId = targetBedId || bedId;

      try {
        await dailyRecord.copyPatientToDate(
          currentRecord.date,
          bedId,
          targetDate,
          finalTargetBedId
        );
        await refresh();
      } catch (error) {
        console.error('Error copying patient to date:', error);
        throw error;
      }
    },
    [refresh, dailyRecord]
  );

  // ========================================================================
  // Public API (memoized to prevent unnecessary re-renders)
  // ========================================================================
  return useMemo(
    () => ({
      // Core State
      record,
      syncStatus,
      lastSyncTime,
      inventory,
      stabilityRules,

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
      toggleBedType: bedManagement.toggleBedType,

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

      // Cross-date Copy
      copyPatientToDate,

      // Handoff Management
      updateHandoffChecklist: handoffManagement.updateHandoffChecklist,
      updateHandoffNovedades: handoffManagement.updateHandoffNovedades,
      updateHandoffStaff: handoffManagement.updateHandoffStaff,
      updateMedicalSignature: handoffManagement.updateMedicalSignature,
      updateMedicalHandoffDoctor: handoffManagement.updateMedicalHandoffDoctor,
      markMedicalHandoffAsSent: handoffManagement.markMedicalHandoffAsSent,
      sendMedicalHandoff: handoffManagement.sendMedicalHandoff,
    }),
    [
      record,
      syncStatus,
      lastSyncTime,
      inventory,
      stabilityRules,
      createDay,
      generateDemo,
      resetDay,
      refresh,
      validateRecordSchema,
      canMovePatient,
      canDischargePatient,
      bedManagement,
      nurseManagement,
      tensManagement,
      dischargeManagement,
      transferManagement,
      cmaManagement,
      handoffManagement,
      copyPatientToDate,
    ]
  );
};
