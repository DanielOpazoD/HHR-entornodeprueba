import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import {
  DEFAULT_TRANSFER_ESCORT,
  normalizeEvacuationMethod,
  normalizeReceivingCenter,
} from '@/constants/clinicalMovementConstants';
import {
  type ActionState,
  createInitialActionState,
  createInitialDischargeState,
  createInitialTransferState,
  type DischargeState,
  type TransferState,
} from '@/domain/censusActionContracts';

export const buildDischargeEditState = (discharge: DischargeData): DischargeState => ({
  bedId: null,
  recordId: discharge.id,
  isOpen: true,
  status: discharge.status,
  type: discharge.dischargeType,
  typeOther: discharge.dischargeTypeOther,
  time: discharge.time,
  movementDate: discharge.movementDate,
  diagnosis: discharge.diagnosis,
});

export const buildTransferEditState = (transfer: TransferData): TransferState => ({
  bedId: null,
  recordId: transfer.id,
  isOpen: true,
  evacuationMethod: normalizeEvacuationMethod(transfer.evacuationMethod),
  evacuationMethodOther: '',
  receivingCenter: normalizeReceivingCenter(transfer.receivingCenter),
  receivingCenterOther: transfer.receivingCenterOther || '',
  transferEscort: transfer.transferEscort || DEFAULT_TRANSFER_ESCORT,
  time: transfer.time,
  movementDate: transfer.movementDate,
  diagnosis: transfer.diagnosis,
});

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
