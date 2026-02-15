import React from 'react';
import { useCensusActionsProviderModel } from '@/features/census/hooks/useCensusActionsProviderModel';
import type { CensusActionsProviderProps } from '@/features/census/types/censusActionContextTypes';
import {
  CensusActionCommandsContext,
  CensusActionStateContext,
  useCensusActionCommands,
  useCensusActions,
  useCensusActionState,
} from '@/features/census/context/censusActionContexts';
export const CensusActionsProvider: React.FC<CensusActionsProviderProps> = ({ children }) => {
  const { stateValue, commandsValue } = useCensusActionsProviderModel();

  return (
    <CensusActionCommandsContext.Provider value={commandsValue}>
      <CensusActionStateContext.Provider value={stateValue}>
        {children}
      </CensusActionStateContext.Provider>
    </CensusActionCommandsContext.Provider>
  );
};
export { useCensusActionState, useCensusActionCommands, useCensusActions };
