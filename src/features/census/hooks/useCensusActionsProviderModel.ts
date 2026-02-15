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
  const {
    actionState,
    setActionState,
    dischargeState,
    setDischargeState,
    transferState,
    setTransferState,
    handleEditDischarge,
    handleEditTransfer,
  } = stateStore;

  const runtimeRefs = useCensusActionRuntimeRefs(
    buildCensusActionRuntimeRefsParams({
      state: stateStore,
      dependencies,
    })
  );

  const { executeMoveOrCopy, executeDischarge, executeTransfer, handleRowAction } =
    useCensusActionCommandsController({
      ...runtimeRefs,
      setActionState,
      setDischargeState,
      setTransferState,
      getCurrentTime,
    });

  return useCensusActionContextValues({
    actionState,
    setActionState,
    dischargeState,
    setDischargeState,
    transferState,
    setTransferState,
    executeMoveOrCopy,
    executeDischarge,
    handleEditDischarge,
    executeTransfer,
    handleEditTransfer,
    handleRowAction,
  });
};
