import { useMemo } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
  useDailyRecordBedActions,
  useDailyRecordMovementActions,
} from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import {
  buildCensusActionDependencies,
  type BuildCensusActionDependenciesParams,
  type CensusActionDependenciesData,
  type CensusActionDependenciesRuntime,
  type CensusActionDependenciesUi,
} from '@/features/census/controllers/censusActionDependenciesController';

interface BuildCensusActionDependenciesModelParams {
  dailyRecordData: CensusActionDependenciesData;
  bedActions: Pick<
    CensusActionDependenciesRuntime,
    'clearPatient' | 'moveOrCopyPatient' | 'copyPatientToDate'
  >;
  movementActions: Pick<
    CensusActionDependenciesRuntime,
    'addDischarge' | 'updateDischarge' | 'addTransfer' | 'updateTransfer' | 'addCMA'
  >;
  confirmDialog: Pick<CensusActionDependenciesUi, 'confirm'>;
  notification: {
    error: CensusActionDependenciesUi['notifyError'];
  };
}

export const buildCensusActionDependenciesModelParams = ({
  dailyRecordData,
  bedActions,
  movementActions,
  confirmDialog,
  notification,
}: BuildCensusActionDependenciesModelParams): BuildCensusActionDependenciesParams => ({
  data: {
    record: dailyRecordData.record,
    stabilityRules: dailyRecordData.stabilityRules,
  },
  runtime: {
    clearPatient: bedActions.clearPatient,
    moveOrCopyPatient: bedActions.moveOrCopyPatient,
    addDischarge: movementActions.addDischarge,
    updateDischarge: movementActions.updateDischarge,
    addTransfer: movementActions.addTransfer,
    updateTransfer: movementActions.updateTransfer,
    addCMA: movementActions.addCMA,
    copyPatientToDate: bedActions.copyPatientToDate,
  },
  ui: {
    confirm: confirmDialog.confirm,
    notifyError: notification.error,
  },
});

export type CensusActionDependencies = CensusActionDependenciesData &
  CensusActionDependenciesRuntime &
  CensusActionDependenciesUi;

export const useCensusActionDependencies = (): CensusActionDependencies => {
  const { record, stabilityRules } = useDailyRecordData();
  const { clearPatient, moveOrCopyPatient, copyPatientToDate } = useDailyRecordBedActions();
  const { addDischarge, updateDischarge, addTransfer, updateTransfer, addCMA } =
    useDailyRecordMovementActions();
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();

  return useMemo(
    () =>
      buildCensusActionDependencies(
        buildCensusActionDependenciesModelParams({
          dailyRecordData: {
            record,
            stabilityRules,
          },
          bedActions: {
            clearPatient,
            moveOrCopyPatient,
            copyPatientToDate,
          },
          movementActions: {
            addDischarge,
            updateDischarge,
            addTransfer,
            updateTransfer,
            addCMA,
          },
          confirmDialog: {
            confirm,
          },
          notification: {
            error: notifyError,
          },
        })
      ),
    [
      addCMA,
      addDischarge,
      addTransfer,
      clearPatient,
      confirm,
      copyPatientToDate,
      moveOrCopyPatient,
      notifyError,
      record,
      stabilityRules,
      updateDischarge,
      updateTransfer,
    ]
  );
};
