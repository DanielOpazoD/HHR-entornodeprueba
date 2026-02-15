import { createContext, useContext, useMemo } from 'react';
import type {
  CensusActionCommandsContextType,
  CensusActionStateContextType,
} from '@/features/census/types/censusActionContextTypes';

export const CensusActionStateContext = createContext<CensusActionStateContextType | undefined>(
  undefined
);
export const CensusActionCommandsContext = createContext<
  CensusActionCommandsContextType | undefined
>(undefined);

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
