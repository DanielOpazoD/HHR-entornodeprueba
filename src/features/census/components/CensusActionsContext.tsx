import React, { createContext, useContext, useMemo } from 'react';
import { useCensusActionCommandsController } from '@/features/census/hooks/useCensusActionCommandsController';
import { useCensusActionRuntimeRefs } from '@/features/census/hooks/useCensusActionRuntimeRefs';
import { useCensusActionDependencies } from '@/features/census/hooks/useCensusActionDependencies';
import { getCurrentClockTimeHHMM } from '@/features/census/controllers/censusClockController';
import { useCensusActionStateStore } from '@/features/census/hooks/useCensusActionStateStore';
import { useCensusActionContextValues } from '@/features/census/hooks/useCensusActionContextValues';
import type {
  CensusActionCommandsContextType,
  CensusActionStateContextType,
  CensusActionsProviderProps,
} from '@/features/census/types/censusActionContextTypes';

const CensusActionStateContext = createContext<CensusActionStateContextType | undefined>(undefined);
const CensusActionCommandsContext = createContext<CensusActionCommandsContextType | undefined>(
  undefined
);
export const CensusActionsProvider: React.FC<CensusActionsProviderProps> = ({ children }) => {
  const {
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
  } = useCensusActionDependencies();

  const {
    actionState,
    setActionState,
    dischargeState,
    setDischargeState,
    transferState,
    setTransferState,
    handleEditDischarge,
    handleEditTransfer,
  } = useCensusActionStateStore();

  const runtimeRefs = useCensusActionRuntimeRefs({
    actionState,
    dischargeState,
    transferState,
    record,
    stabilityRules,
    clearPatient,
    moveOrCopyPatient,
    addDischarge,
    updateDischarge,
    addTransfer,
    updateTransfer,
    addCma: addCMA,
    copyPatientToDate,
    confirm,
    notifyError,
  });

  const { executeMoveOrCopy, executeDischarge, executeTransfer, handleRowAction } =
    useCensusActionCommandsController({
      ...runtimeRefs,
      setActionState,
      setDischargeState,
      setTransferState,
      getCurrentTime: getCurrentClockTimeHHMM,
    });

  const { stateValue, commandsValue } = useCensusActionContextValues({
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

  return (
    <CensusActionCommandsContext.Provider value={commandsValue}>
      <CensusActionStateContext.Provider value={stateValue}>
        {children}
      </CensusActionStateContext.Provider>
    </CensusActionCommandsContext.Provider>
  );
};

export const useCensusActionState = (): CensusActionStateContextType => {
  const context = useContext(CensusActionStateContext);
  if (!context) {
    throw new Error('useCensusActionState must be used within a CensusActionsProvider');
  }
  return context;
};

export const useCensusActionCommands = (): CensusActionCommandsContextType => {
  const context = useContext(CensusActionCommandsContext);
  if (!context) {
    throw new Error('useCensusActionCommands must be used within a CensusActionsProvider');
  }
  return context;
};

export const useCensusActions = (): CensusActionStateContextType &
  CensusActionCommandsContextType => {
  const state = useCensusActionState();
  const commands = useCensusActionCommands();

  return useMemo(() => ({ ...state, ...commands }), [state, commands]);
};
