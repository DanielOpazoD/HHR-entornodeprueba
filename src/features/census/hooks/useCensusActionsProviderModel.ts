import { getCurrentClockTimeHHMM } from '@/features/census/controllers/censusClockController';
import { buildCensusActionRuntimeRefsParams } from '@/features/census/controllers/censusActionRuntimeRefsController';
import { useCensusActionCommandsController } from '@/features/census/hooks/useCensusActionCommandsController';
import { useCensusActionContextValues } from '@/features/census/hooks/useCensusActionContextValues';
import { useCensusActionDependencies } from '@/features/census/hooks/useCensusActionDependencies';
import { useCensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useCensusActionStateStore } from '@/features/census/hooks/useCensusActionStateStore';
import type {
  CensusActionCommandsContextType,
  CensusActionStateContextType,
} from '@/features/census/types/censusActionContextTypes';

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
