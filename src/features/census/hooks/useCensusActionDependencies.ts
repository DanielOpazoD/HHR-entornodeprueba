import { useDailyRecordActions, useDailyRecordData } from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';

export interface CensusActionDependencies {
  record: ReturnType<typeof useDailyRecordData>['record'];
  stabilityRules: ReturnType<typeof useDailyRecordData>['stabilityRules'];
  clearPatient: ReturnType<typeof useDailyRecordActions>['clearPatient'];
  moveOrCopyPatient: ReturnType<typeof useDailyRecordActions>['moveOrCopyPatient'];
  addDischarge: ReturnType<typeof useDailyRecordActions>['addDischarge'];
  updateDischarge: ReturnType<typeof useDailyRecordActions>['updateDischarge'];
  addTransfer: ReturnType<typeof useDailyRecordActions>['addTransfer'];
  updateTransfer: ReturnType<typeof useDailyRecordActions>['updateTransfer'];
  addCMA: ReturnType<typeof useDailyRecordActions>['addCMA'];
  copyPatientToDate: ReturnType<typeof useDailyRecordActions>['copyPatientToDate'];
  confirm: ReturnType<typeof useConfirmDialog>['confirm'];
  notifyError: ReturnType<typeof useNotification>['error'];
}

export const useCensusActionDependencies = (): CensusActionDependencies => {
  const { record, stabilityRules } = useDailyRecordData();
  const {
    clearPatient,
    moveOrCopyPatient,
    addDischarge,
    updateDischarge,
    addTransfer,
    updateTransfer,
    addCMA,
    copyPatientToDate,
  } = useDailyRecordActions();
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();

  return {
    record,
    stabilityRules,
    clearPatient,
    moveOrCopyPatient,
    addDischarge,
    updateDischarge,
    addTransfer,
    updateTransfer,
    addCMA,
    copyPatientToDate,
    confirm,
    notifyError,
  };
};
