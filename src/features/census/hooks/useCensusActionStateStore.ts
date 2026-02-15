import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { DischargeData, TransferData } from '@/types';
import {
  type ActionState,
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
  type DischargeState,
  type TransferState,
} from '@/features/census/types/censusActionTypes';
import {
  buildDischargeEditState,
  buildTransferEditState,
} from '@/features/census/controllers/censusEditStateController';

export interface CensusActionStateStore {
  actionState: ActionState;
  setActionState: Dispatch<SetStateAction<ActionState>>;
  dischargeState: DischargeState;
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  transferState: TransferState;
  setTransferState: Dispatch<SetStateAction<TransferState>>;
  handleEditDischarge: (discharge: DischargeData) => void;
  handleEditTransfer: (transfer: TransferData) => void;
}

export const useCensusActionStateStore = (): CensusActionStateStore => {
  const [actionState, setActionState] = useState<ActionState>(createInitialActionState);
  const [dischargeState, setDischargeState] = useState<DischargeState>(createInitialDischargeState);
  const [transferState, setTransferState] = useState<TransferState>(createInitialTransferState);

  const handleEditDischarge = useCallback((discharge: DischargeData) => {
    setDischargeState(buildDischargeEditState(discharge));
  }, []);

  const handleEditTransfer = useCallback((transfer: TransferData) => {
    setTransferState(buildTransferEditState(transfer));
  }, []);

  return {
    actionState,
    setActionState,
    dischargeState,
    setDischargeState,
    transferState,
    setTransferState,
    handleEditDischarge,
    handleEditTransfer,
  };
};
