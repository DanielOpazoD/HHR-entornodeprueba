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
type DailyRecordCudyrActions = Pick<
  DailyRecordActionsContextType,
  | 'updateCudyr'
  | 'updateCudyrMultiple'
  | 'updateCudyrBatch'
  | 'updateClinicalCribCudyr'
  | 'updateClinicalCribCudyrMultiple'
>;

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
      updateClinicalCribCudyr: actions.updateClinicalCribCudyr,
      updateClinicalCribCudyrMultiple: actions.updateClinicalCribCudyrMultiple,
      updateCudyr: actions.updateCudyr,
      updateCudyrMultiple: actions.updateCudyrMultiple,
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
      actions.updateClinicalCribCudyr,
      actions.updateClinicalCribCudyrMultiple,
      actions.updateClinicalCribMultiple,
      actions.updateCudyr,
      actions.updateCudyrMultiple,
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
      addTransfer: actions.addTransfer,
      updateTransfer: actions.updateTransfer,
      deleteTransfer: actions.deleteTransfer,
      undoTransfer: actions.undoTransfer,
      addCMA: actions.addCMA,
      deleteCMA: actions.deleteCMA,
      updateCMA: actions.updateCMA,
      undoCMA: actions.undoCMA,
      convertCmaToHomeDischarge: actions.convertCmaToHomeDischarge,
    }),
    [
      actions.addCMA,
      actions.addDischarge,
      actions.addTransfer,
      actions.convertCmaToHomeDischarge,
      actions.convertDischargeToCma,
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

export const useDailyRecordCudyrActions = (): DailyRecordCudyrActions => {
  const actions = useResolvedActionsContext('useDailyRecordCudyrActions');
  return useMemo(
    () => ({
      updateCudyr: actions.updateCudyr,
      updateCudyrMultiple: actions.updateCudyrMultiple,
      updateCudyrBatch: actions.updateCudyrBatch,
      updateClinicalCribCudyr: actions.updateClinicalCribCudyr,
      updateClinicalCribCudyrMultiple: actions.updateClinicalCribCudyrMultiple,
    }),
    [
      actions.updateClinicalCribCudyr,
      actions.updateClinicalCribCudyrMultiple,
      actions.updateCudyr,
      actions.updateCudyrBatch,
      actions.updateCudyrMultiple,
    ]
  );
};

export const useDailyRecordHandoffActions = (): DailyRecordHandoffActions => {
  const actions = useResolvedActionsContext('useDailyRecordHandoffActions');
  return useMemo(
    () => ({
      updateHandoffChecklist: actions.updateHandoffChecklist,
      updateHandoffNovedades: actions.updateHandoffNovedades,
      updateMedicalSpecialtyNote: actions.updateMedicalSpecialtyNote,
      confirmMedicalSpecialtyNoChanges: actions.confirmMedicalSpecialtyNoChanges,
      updateHandoffStaff: actions.updateHandoffStaff,
      updateMedicalSignature: actions.updateMedicalSignature,
      updateMedicalHandoffDoctor: actions.updateMedicalHandoffDoctor,
      markMedicalHandoffAsSent: actions.markMedicalHandoffAsSent,
      ensureMedicalHandoffSignatureLink: actions.ensureMedicalHandoffSignatureLink,
      resetMedicalHandoffState: actions.resetMedicalHandoffState,
      sendMedicalHandoff: actions.sendMedicalHandoff,
    }),
    [
      actions.ensureMedicalHandoffSignatureLink,
      actions.markMedicalHandoffAsSent,
      actions.resetMedicalHandoffState,
      actions.sendMedicalHandoff,
      actions.updateHandoffChecklist,
      actions.updateHandoffNovedades,
      actions.updateMedicalSpecialtyNote,
      actions.confirmMedicalSpecialtyNoChanges,
      actions.updateHandoffStaff,
      actions.updateMedicalHandoffDoctor,
      actions.updateMedicalSignature,
    ]
  );
};
