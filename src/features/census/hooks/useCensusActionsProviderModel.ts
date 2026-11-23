import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { useCensusActionCommandsController } from '@/features/census/hooks/useCensusActionCommandsController';
import { useCensusActionContextValues } from '@/features/census/hooks/useCensusActionContextValues';
import {
  useCensusActionDependencies,
  type CensusActionDependencies,
} from '@/features/census/hooks/useCensusActionDependencies';
import {
  useCensusActionRuntimeRefs,
  type UseCensusActionRuntimeRefsParams,
} from '@/features/census/hooks/useCensusActionRuntimeRefs';
import {
  useCensusActionStateStore,
  type CensusActionStateStore,
} from '@/features/census/hooks/useCensusActionStateStore';
import type {
  CensusActionCommandsContextType,
  CensusActionStateContextType,
} from '@/features/census/types/censusActionContextTypes';

type CensusActionRuntimeRefState = Pick<
  CensusActionStateStore,
  'actionState' | 'dischargeState' | 'transferState'
>;

interface BuildCensusActionRuntimeRefsParams {
  state: CensusActionRuntimeRefState;
  dependencies: CensusActionDependencies;
}

export const buildCensusActionRuntimeRefsParams = ({
  state,
  dependencies,
}: BuildCensusActionRuntimeRefsParams): UseCensusActionRuntimeRefsParams => ({
  actionState: state.actionState,
  dischargeState: state.dischargeState,
  transferState: state.transferState,
  record: dependencies.record,
  stabilityRules: dependencies.stabilityRules,
  clearPatient: dependencies.clearPatient,
  moveOrCopyPatient: dependencies.moveOrCopyPatient,
  addDischarge: dependencies.addDischarge,
  updateDischarge: dependencies.updateDischarge,
  addTransfer: dependencies.addTransfer,
  updateTransfer: dependencies.updateTransfer,
  addCma: dependencies.addCMA,
  copyPatientToDate: dependencies.copyPatientToDate,
  confirm: dependencies.confirm,
  notifyError: dependencies.notifyError,
});

export const getCurrentClockTimeHHMM = (dateProvider: () => Date = () => new Date()): string =>
  calendarStampInClinicalTimeZone(dateProvider()).hhmm;

interface UseCensusActionsProviderModelParams {
  getCurrentTime?: () => string;
}

interface UseCensusActionsProviderModelResult {
  stateValue: CensusActionStateContextType;
  commandsValue: CensusActionCommandsContextType;
}

export const useCensusActionsProviderModel = ({
  getCurrentTime = getCurrentClockTimeHHMM,
}: UseCensusActionsProviderModelParams = {}): UseCensusActionsProviderModelResult => {
  const dependencies = useCensusActionDependencies();
  const stateStore = useCensusActionStateStore();
  const runtimeRefs = useCensusActionRuntimeRefs(
    buildCensusActionRuntimeRefsParams({
      state: stateStore,
      dependencies,
    })
  );

  const commands = useCensusActionCommandsController({
    ...runtimeRefs,
    setActionState: stateStore.setActionState,
    setDischargeState: stateStore.setDischargeState,
    setTransferState: stateStore.setTransferState,
    getCurrentTime,
  });

  return useCensusActionContextValues({
    actionState: stateStore.actionState,
    setActionState: stateStore.setActionState,
    dischargeState: stateStore.dischargeState,
    setDischargeState: stateStore.setDischargeState,
    transferState: stateStore.transferState,
    setTransferState: stateStore.setTransferState,
    ...commands,
    handleEditDischarge: stateStore.handleEditDischarge,
    handleEditTransfer: stateStore.handleEditTransfer,
  });
};
