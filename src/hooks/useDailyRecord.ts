import { useMemo } from 'react';

// Sub-hooks
import { usePersistence } from './usePersistence';

// Sync hooks
import { useDailyRecordSyncQuery } from './useDailyRecordSyncQuery';

// Domain hooks
import { useRepositories } from '@/context/RepositoryContext';
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

  const { inventory, stabilityRules, bedManagement } = useDailyRecordDomainModules(
    record,
    patchRecord,
    ensureStaleDayEditAllowed
  );

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
      saveAndUpdate,
      patchRecord,
      updatePatient: bedManagement.updatePatient,
      confirmUpcRound: bedManagement.confirmUpcRound,
      updatePatientMultiple: bedManagement.updatePatientMultiple,
      updateClinicalCrib: bedManagement.updateClinicalCrib,
      updateClinicalCribMultiple: bedManagement.updateClinicalCribMultiple,
      clearPatient: bedManagement.clearPatient,
      clearAllBeds: bedManagement.clearAllBeds,
      moveOrCopyPatient: bedManagement.moveOrCopyPatient,
      toggleBlockBed: bedManagement.toggleBlockBed,
      updateBlockedReason: bedManagement.updateBlockedReason,
      toggleBedType: bedManagement.toggleBedType,
      copyPatientToDate,
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
      saveAndUpdate,
      patchRecord,
      bedManagement,
      copyPatientToDate,
    ]
  );
};
