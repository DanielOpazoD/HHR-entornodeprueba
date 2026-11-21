import { useMemo } from 'react';

// Sub-hooks
import { usePersistence } from './usePersistence';

// Sync hooks
import { useDailyRecordSyncQuery } from './useDailyRecordSyncQuery';

// Domain hooks
import { useRepositories } from '@/services/RepositoryContext';
import { useNotification } from '@/context/UIContext';
import { useDailyRecordDomainModules } from '@/hooks/useDailyRecordDomainModules';
import type { StaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';
import { useDailyRecordCopyActions } from '@/hooks/useDailyRecordCopyActions';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';

// Types
import { DailyRecordContextType } from '@/context/dailyRecordContextContracts';

/**
 * Main hook for daily record management.
 * Orchestrates sync, persistence, and domain operations.
 */
export const useDailyRecord = (
  currentDateString: string,
  remoteSyncStatus: RemoteSyncRuntimeStatus = 'local_only',
  ensureStaleDayEditAllowed?: StaleDayEditGuard
): DailyRecordContextType => {
  const { dailyRecord } = useRepositories();
  const { warning } = useNotification();

  // ========================================================================
  // Sync & State Management
  // ========================================================================
  const {
    record,
    setRecord,
    syncStatus,
    hasSaveException,
    lastSyncTime,
    bootstrapPhase,
    saveAndUpdate,
    markLocalChange,
    refresh,
    patchRecord,
  } = useDailyRecordSyncQuery(currentDateString, remoteSyncStatus);

  // ========================================================================
  // Orchestrated Sub-hooks
  // ========================================================================
  const { createDay, resetDay } = usePersistence({
    currentDateString,
    markLocalChange,
    setRecord,
  });

  const {
    inventory,
    stabilityRules,
    bedManagement,
    dischargeManagement,
    transferManagement,
    shiftStaffManagement,
    staffingManagement,
    cmaManagement,
    handoffManagement,
  } = useDailyRecordDomainModules(record, saveAndUpdate, patchRecord, ensureStaleDayEditAllowed);

  // ========================================================================
  // Cross-date Copy
  // ========================================================================
  const copyPatientToDate = useDailyRecordCopyActions({
    record,
    refresh,
    dailyRecord,
    warning,
  });

  // ========================================================================
  // Public API (memoized to prevent unnecessary re-renders)
  // ========================================================================
  return useMemo<DailyRecordContextType>(
    () => ({
      record,
      syncStatus,
      hasSaveException,
      lastSyncTime,
      bootstrapPhase,
      inventory,
      stabilityRules,
      createDay,
      resetDay,
      refresh,
      updatePatient: bedManagement.updatePatient,
      updatePatientMultiple: bedManagement.updatePatientMultiple,
      updateClinicalCrib: bedManagement.updateClinicalCrib,
      updateClinicalCribMultiple: bedManagement.updateClinicalCribMultiple,
      clearPatient: bedManagement.clearPatient,
      clearAllBeds: bedManagement.clearAllBeds,
      moveOrCopyPatient: bedManagement.moveOrCopyPatient,
      toggleBlockBed: bedManagement.toggleBlockBed,
      updateBlockedReason: bedManagement.updateBlockedReason,
      toggleExtraBed: bedManagement.toggleExtraBed,
      toggleBedType: bedManagement.toggleBedType,
      updateShiftStaff: shiftStaffManagement.updateShiftStaff,
      updateDetailedStaffing: staffingManagement.updateDetailedStaffing,
      addDischarge: dischargeManagement.addDischarge,
      updateDischarge: dischargeManagement.updateDischarge,
      deleteDischarge: dischargeManagement.deleteDischarge,
      undoDischarge: dischargeManagement.undoDischarge,
      convertDischargeToCma: dischargeManagement.convertDischargeToCma,
      convertDischargeToTransfer: dischargeManagement.convertDischargeToTransfer,
      addTransfer: transferManagement.addTransfer,
      updateTransfer: transferManagement.updateTransfer,
      deleteTransfer: transferManagement.deleteTransfer,
      undoTransfer: transferManagement.undoTransfer,
      convertTransferToHomeDischarge: transferManagement.convertTransferToHomeDischarge,
      convertTransferToCma: transferManagement.convertTransferToCma,
      addCMA: cmaManagement.addCMA,
      deleteCMA: cmaManagement.deleteCMA,
      updateCMA: cmaManagement.updateCMA,
      undoCMA: cmaManagement.undoCMA,
      convertCmaToHomeDischarge: cmaManagement.convertCmaToHomeDischarge,
      convertCmaToTransfer: cmaManagement.convertCmaToTransfer,
      copyPatientToDate,
      updateHandoffChecklist: handoffManagement.updateHandoffChecklist,
      updateHandoffNovedades: handoffManagement.updateHandoffNovedades,
      updateHandoffReceives: handoffManagement.updateHandoffReceives,
    }),
    [
      record,
      syncStatus,
      hasSaveException,
      lastSyncTime,
      bootstrapPhase,
      inventory,
      stabilityRules,
      createDay,
      resetDay,
      refresh,
      bedManagement,
      shiftStaffManagement,
      staffingManagement,
      dischargeManagement,
      transferManagement,
      cmaManagement,
      handoffManagement,
      copyPatientToDate,
    ]
  );
};
