import type { Dispatch, SetStateAction } from 'react';
import {
  applyDischargePatch,
  applyTransferPatch,
} from '@/features/census/controllers/censusModalStateController';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import type { RowActionRuntimeActions } from '@/features/census/types/censusRowActionRuntimeTypes';

interface BuildRowActionRuntimeActionsParams {
  clearPatient: RowActionRuntimeActions['clearPatient'];
  addCMA: RowActionRuntimeActions['addCMA'];
  setActionState: Dispatch<SetStateAction<ActionState>>;
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  setTransferState: Dispatch<SetStateAction<TransferState>>;
}

export const buildRowActionRuntimeActions = ({
  clearPatient,
  addCMA,
  setActionState,
  setDischargeState,
  setTransferState,
}: BuildRowActionRuntimeActionsParams): RowActionRuntimeActions => ({
  clearPatient,
  addCMA,
  setMovement: setActionState,
  openDischarge: dischargePatch => {
    setDischargeState(previousState => applyDischargePatch(previousState, dischargePatch));
  },
  openTransfer: transferPatch => {
    setTransferState(previousState => applyTransferPatch(previousState, transferPatch));
  },
});
