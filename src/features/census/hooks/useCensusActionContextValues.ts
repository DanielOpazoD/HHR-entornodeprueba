import { useMemo } from 'react';
import type {
  CensusActionCommandsContextType,
  CensusActionStateContextType,
} from '@/features/census/types/censusActionContextTypes';

interface UseCensusActionContextValuesParams {
  actionState: CensusActionStateContextType['actionState'];
  setActionState: CensusActionStateContextType['setActionState'];
  dischargeState: CensusActionStateContextType['dischargeState'];
  setDischargeState: CensusActionStateContextType['setDischargeState'];
  transferState: CensusActionStateContextType['transferState'];
  setTransferState: CensusActionStateContextType['setTransferState'];
  executeMoveOrCopy: CensusActionCommandsContextType['executeMoveOrCopy'];
  executeDischarge: CensusActionCommandsContextType['executeDischarge'];
  handleEditDischarge: CensusActionCommandsContextType['handleEditDischarge'];
  executeTransfer: CensusActionCommandsContextType['executeTransfer'];
  handleEditTransfer: CensusActionCommandsContextType['handleEditTransfer'];
  handleRowAction: CensusActionCommandsContextType['handleRowAction'];
}

interface UseCensusActionContextValuesResult {
  stateValue: CensusActionStateContextType;
  commandsValue: CensusActionCommandsContextType;
}

export const useCensusActionContextValues = ({
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
}: UseCensusActionContextValuesParams): UseCensusActionContextValuesResult => {
  const stateValue = useMemo<CensusActionStateContextType>(
    () => ({
      actionState,
      setActionState,
      dischargeState,
      setDischargeState,
      transferState,
      setTransferState,
    }),
    [
      actionState,
      dischargeState,
      setActionState,
      setDischargeState,
      setTransferState,
      transferState,
    ]
  );

  const commandsValue = useMemo<CensusActionCommandsContextType>(
    () => ({
      executeMoveOrCopy,
      executeDischarge,
      handleEditDischarge,
      executeTransfer,
      handleEditTransfer,
      handleRowAction,
    }),
    [
      executeMoveOrCopy,
      executeDischarge,
      handleEditDischarge,
      executeTransfer,
      handleEditTransfer,
      handleRowAction,
    ]
  );

  return {
    stateValue,
    commandsValue,
  };
};
