import { useMemo } from 'react';
import { useDailyRecordActions, useDailyRecordData } from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import {
  buildCensusActionDependencies,
  type CensusActionDependenciesData,
  type CensusActionDependenciesRuntime,
  type CensusActionDependenciesUi,
} from '@/features/census/controllers/censusActionDependenciesController';

export type CensusActionDependencies = CensusActionDependenciesData &
  CensusActionDependenciesRuntime &
  CensusActionDependenciesUi;

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

  return useMemo(
    () =>
      buildCensusActionDependencies({
        data: {
          record,
          stabilityRules,
        },
        runtime: {
          clearPatient,
          moveOrCopyPatient,
          addDischarge,
          updateDischarge,
          addTransfer,
          updateTransfer,
          addCMA,
          copyPatientToDate,
        },
        ui: {
          confirm,
          notifyError,
        },
      }),
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
