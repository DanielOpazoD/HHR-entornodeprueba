import { useMemo } from 'react';
import type { DailyRecordActionsContextType } from '@/context/dailyRecordContextContracts';
import type {
  DailyRecordBedActions,
  DailyRecordDayActions,
  DailyRecordHandoffActions,
  DailyRecordMovementActions,
  DailyRecordStaffActions,
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

export const useDailyRecordBedActions = (): DailyRecordBedActions => {
  const actions = useResolvedActionsContext('useDailyRecordBedActions');
  return useMemo(
    () => ({
      updatePatient: actions.updatePatient,
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
      actions.updatePatientMultiple,
    ]
  );
};

export const useDailyRecordMovementActions = (): DailyRecordMovementActions => {
  const actions = useResolvedActionsContext('useDailyRecordMovementActions');
  return useMemo(
    () => ({
      addDischarge: actions.addDischarge,
      updateDischarge: actions.updateDischarge,
      deleteDischarge: actions.deleteDischarge,
      undoDischarge: actions.undoDischarge,
      convertDischargeToCma: actions.convertDischargeToCma,
      convertDischargeToTransfer: actions.convertDischargeToTransfer,
      addTransfer: actions.addTransfer,
      updateTransfer: actions.updateTransfer,
      deleteTransfer: actions.deleteTransfer,
      undoTransfer: actions.undoTransfer,
      convertTransferToHomeDischarge: actions.convertTransferToHomeDischarge,
      convertTransferToCma: actions.convertTransferToCma,
      addCMA: actions.addCMA,
      deleteCMA: actions.deleteCMA,
      updateCMA: actions.updateCMA,
      undoCMA: actions.undoCMA,
      convertCmaToHomeDischarge: actions.convertCmaToHomeDischarge,
      convertCmaToTransfer: actions.convertCmaToTransfer,
    }),
    [
      actions.addCMA,
      actions.addDischarge,
      actions.addTransfer,
      actions.convertCmaToHomeDischarge,
      actions.convertCmaToTransfer,
      actions.convertDischargeToCma,
      actions.convertDischargeToTransfer,
      actions.convertTransferToCma,
      actions.convertTransferToHomeDischarge,
      actions.deleteCMA,
      actions.deleteDischarge,
      actions.deleteTransfer,
      actions.undoCMA,
      actions.undoDischarge,
      actions.undoTransfer,
      actions.updateCMA,
      actions.updateDischarge,
      actions.updateTransfer,
    ]
  );
};

export const useDailyRecordStaffActions = (): DailyRecordStaffActions => {
  const actions = useResolvedActionsContext('useDailyRecordStaffActions');
  return useMemo(
    () => ({
      updateNurse: actions.updateNurse,
      updateTens: actions.updateTens,
      updateDetailedStaffing: actions.updateDetailedStaffing,
    }),
    [actions.updateDetailedStaffing, actions.updateNurse, actions.updateTens]
  );
};

export const useDailyRecordHandoffActions = (): DailyRecordHandoffActions => {
  const actions = useResolvedActionsContext('useDailyRecordHandoffActions');
  return useMemo(
    () => ({
      updateHandoffChecklist: actions.updateHandoffChecklist,
      updateHandoffNovedades: actions.updateHandoffNovedades,
      updateHandoffReceives: actions.updateHandoffReceives,
    }),
    [actions.updateHandoffChecklist, actions.updateHandoffNovedades, actions.updateHandoffReceives]
  );
};
