import { useMemo } from 'react';
import type {
  DailyRecordActionsContextType,
  DailyRecordBedActions,
  DailyRecordDayActions,
  DailyRecordPersistenceActions,
} from '@/context/dailyRecordContextContracts';
import { useRequiredDailyRecordActionsContext } from '@/context/dailyRecordActionsContext';

const useResolvedActionsContext = (hookName: string): DailyRecordActionsContextType => {
  return useRequiredDailyRecordActionsContext(hookName);
};

export const useDailyRecordDayActions = (): DailyRecordDayActions => {
  const actions = useResolvedActionsContext('useDailyRecordDayActions');
  return useMemo(
    () => ({
      createDay: actions.createDay,
      resetDay: actions.resetDay,
      refresh: actions.refresh,
    }),
    [actions.createDay, actions.refresh, actions.resetDay]
  );
};

export const useDailyRecordPersistenceActions = (): DailyRecordPersistenceActions => {
  const actions = useResolvedActionsContext('useDailyRecordPersistenceActions');
  return useMemo(
    () => ({
      saveAndUpdate: actions.saveAndUpdate,
      patchRecord: actions.patchRecord,
    }),
    [actions.patchRecord, actions.saveAndUpdate]
  );
};

export const useDailyRecordBedActions = (): DailyRecordBedActions => {
  const actions = useResolvedActionsContext('useDailyRecordBedActions');
  return useMemo(
    () => ({
      updatePatient: actions.updatePatient,
      confirmUpcRound: actions.confirmUpcRound,
      updatePatientMultiple: actions.updatePatientMultiple,
      updateClinicalCrib: actions.updateClinicalCrib,
      updateClinicalCribMultiple: actions.updateClinicalCribMultiple,
      clearPatient: actions.clearPatient,
      clearAllBeds: actions.clearAllBeds,
      moveOrCopyPatient: actions.moveOrCopyPatient,
      toggleBlockBed: actions.toggleBlockBed,
      updateBlockedReason: actions.updateBlockedReason,
      toggleExtraBed: actions.toggleExtraBed,
      toggleBedType: actions.toggleBedType,
      copyPatientToDate: actions.copyPatientToDate,
    }),
    [
      actions.clearAllBeds,
      actions.clearPatient,
      actions.copyPatientToDate,
      actions.moveOrCopyPatient,
      actions.toggleBedType,
      actions.toggleBlockBed,
      actions.toggleExtraBed,
      actions.updateBlockedReason,
      actions.updateClinicalCrib,
      actions.updateClinicalCribMultiple,
      actions.updatePatient,
      actions.confirmUpcRound,
      actions.updatePatientMultiple,
    ]
  );
};
