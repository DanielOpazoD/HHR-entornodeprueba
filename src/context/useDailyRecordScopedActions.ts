import { useMemo } from 'react';
import type { DailyRecordActionsContextType } from '@/hooks/useDailyRecordTypes';
import { useRequiredDailyRecordActionsContext } from '@/context/DailyRecordContext';

type DailyRecordDayActions = Pick<
  DailyRecordActionsContextType,
  'createDay' | 'generateDemo' | 'resetDay' | 'refresh'
>;
type DailyRecordBedActions = Pick<
  DailyRecordActionsContextType,
  | 'updatePatient'
  | 'updatePatientMultiple'
  | 'updateClinicalCrib'
  | 'updateClinicalCribMultiple'
  | 'updateClinicalCribCudyr'
  | 'updateClinicalCribCudyrMultiple'
  | 'updateCudyr'
  | 'updateCudyrMultiple'
  | 'clearPatient'
  | 'clearAllBeds'
  | 'moveOrCopyPatient'
  | 'toggleBlockBed'
  | 'updateBlockedReason'
  | 'toggleExtraBed'
  | 'toggleBedType'
  | 'copyPatientToDate'
>;
type DailyRecordMovementActions = Pick<
  DailyRecordActionsContextType,
  | 'addDischarge'
  | 'updateDischarge'
  | 'deleteDischarge'
  | 'undoDischarge'
  | 'addTransfer'
  | 'updateTransfer'
  | 'deleteTransfer'
  | 'undoTransfer'
  | 'addCMA'
  | 'deleteCMA'
  | 'updateCMA'
>;
type DailyRecordStaffActions = Pick<DailyRecordActionsContextType, 'updateNurse' | 'updateTens'>;
type DailyRecordCudyrActions = Pick<
  DailyRecordActionsContextType,
  | 'updateCudyr'
  | 'updateCudyrMultiple'
  | 'updateClinicalCribCudyr'
  | 'updateClinicalCribCudyrMultiple'
>;
type DailyRecordHandoffActions = Pick<
  DailyRecordActionsContextType,
  | 'updateHandoffChecklist'
  | 'updateHandoffNovedades'
  | 'updateHandoffStaff'
  | 'updateMedicalSignature'
  | 'updateMedicalHandoffDoctor'
  | 'markMedicalHandoffAsSent'
  | 'sendMedicalHandoff'
>;

export const useDailyRecordDayActions = (): DailyRecordDayActions => {
  const actions = useRequiredDailyRecordActionsContext('useDailyRecordDayActions');
  return useMemo(
    () => ({
      createDay: actions.createDay,
      generateDemo: actions.generateDemo,
      resetDay: actions.resetDay,
      refresh: actions.refresh,
    }),
    [actions.createDay, actions.generateDemo, actions.refresh, actions.resetDay]
  );
};

export const useDailyRecordBedActions = (): DailyRecordBedActions => {
  const actions = useRequiredDailyRecordActionsContext('useDailyRecordBedActions');
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
  const actions = useRequiredDailyRecordActionsContext('useDailyRecordMovementActions');
  return useMemo(
    () => ({
      addDischarge: actions.addDischarge,
      updateDischarge: actions.updateDischarge,
      deleteDischarge: actions.deleteDischarge,
      undoDischarge: actions.undoDischarge,
      addTransfer: actions.addTransfer,
      updateTransfer: actions.updateTransfer,
      deleteTransfer: actions.deleteTransfer,
      undoTransfer: actions.undoTransfer,
      addCMA: actions.addCMA,
      deleteCMA: actions.deleteCMA,
      updateCMA: actions.updateCMA,
    }),
    [
      actions.addCMA,
      actions.addDischarge,
      actions.addTransfer,
      actions.deleteCMA,
      actions.deleteDischarge,
      actions.deleteTransfer,
      actions.undoDischarge,
      actions.undoTransfer,
      actions.updateCMA,
      actions.updateDischarge,
      actions.updateTransfer,
    ]
  );
};

export const useDailyRecordStaffActions = (): DailyRecordStaffActions => {
  const actions = useRequiredDailyRecordActionsContext('useDailyRecordStaffActions');
  return useMemo(
    () => ({
      updateNurse: actions.updateNurse,
      updateTens: actions.updateTens,
    }),
    [actions.updateNurse, actions.updateTens]
  );
};

export const useDailyRecordCudyrActions = (): DailyRecordCudyrActions => {
  const actions = useRequiredDailyRecordActionsContext('useDailyRecordCudyrActions');
  return useMemo(
    () => ({
      updateCudyr: actions.updateCudyr,
      updateCudyrMultiple: actions.updateCudyrMultiple,
      updateClinicalCribCudyr: actions.updateClinicalCribCudyr,
      updateClinicalCribCudyrMultiple: actions.updateClinicalCribCudyrMultiple,
    }),
    [
      actions.updateClinicalCribCudyr,
      actions.updateClinicalCribCudyrMultiple,
      actions.updateCudyr,
      actions.updateCudyrMultiple,
    ]
  );
};

export const useDailyRecordHandoffActions = (): DailyRecordHandoffActions => {
  const actions = useRequiredDailyRecordActionsContext('useDailyRecordHandoffActions');
  return useMemo(
    () => ({
      updateHandoffChecklist: actions.updateHandoffChecklist,
      updateHandoffNovedades: actions.updateHandoffNovedades,
      updateHandoffStaff: actions.updateHandoffStaff,
      updateMedicalSignature: actions.updateMedicalSignature,
      updateMedicalHandoffDoctor: actions.updateMedicalHandoffDoctor,
      markMedicalHandoffAsSent: actions.markMedicalHandoffAsSent,
      sendMedicalHandoff: actions.sendMedicalHandoff,
    }),
    [
      actions.markMedicalHandoffAsSent,
      actions.sendMedicalHandoff,
      actions.updateHandoffChecklist,
      actions.updateHandoffNovedades,
      actions.updateHandoffStaff,
      actions.updateMedicalHandoffDoctor,
      actions.updateMedicalSignature,
    ]
  );
};
