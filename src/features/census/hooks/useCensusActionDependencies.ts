import { useMemo } from 'react';
import {
  useDailyRecordBedActions,
  useDailyRecordData,
  useDailyRecordMovementActions,
} from '@/context/DailyRecordContext';
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
  const { clearPatient, moveOrCopyPatient, copyPatientToDate } = useDailyRecordBedActions();
  const { addDischarge, updateDischarge, addTransfer, updateTransfer, addCMA } =
    useDailyRecordMovementActions();
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
