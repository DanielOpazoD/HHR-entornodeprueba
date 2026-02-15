import type { DischargeData, TransferData } from '@/types';
import type { DischargeTarget, TransferState } from '@/features/census/types/censusActionTypes';

export type MovementStatus = DischargeData['status'];

export type AddDischargeAction = (
  bedId: string,
  status: MovementStatus,
  cribStatus?: MovementStatus,
  dischargeType?: string,
  dischargeTypeOther?: string,
  time?: string,
  target?: DischargeTarget
) => void;

export type UpdateDischargeAction = (
  id: string,
  status: MovementStatus,
  dischargeType?: string,
  dischargeTypeOther?: string,
  time?: string,
  movementDate?: string
) => void;

export type DeleteDischargeAction = (id: string) => void;
export type UndoDischargeAction = (id: string) => void;

export type AddTransferAction = (
  bedId: string,
  method: string,
  center: string,
  centerOther: string,
  escort?: string,
  time?: string
) => void;

export type UpdateTransferAction = (id: string, updates: Partial<TransferData>) => void;
export type DeleteTransferAction = (id: string) => void;
export type UndoTransferAction = (id: string) => void;

export interface DischargeMovementActions {
  addDischarge: AddDischargeAction;
  updateDischarge: UpdateDischargeAction;
  deleteDischarge: DeleteDischargeAction;
  undoDischarge: UndoDischargeAction;
}

export interface TransferMovementActions {
  addTransfer: AddTransferAction;
  updateTransfer: UpdateTransferAction;
  deleteTransfer: DeleteTransferAction;
  undoTransfer: UndoTransferAction;
}

export type PatientMovementActions = DischargeMovementActions & TransferMovementActions;

export interface DischargeExecutionInput {
  status: MovementStatus;
  type?: string;
  typeOther?: string;
  time?: string;
  movementDate?: string;
  dischargeTarget?: DischargeTarget;
}

export interface TransferExecutionInput {
  time?: string;
  movementDate?: string;
}

export interface DischargeUpdateCommandPayload {
  status: MovementStatus;
  type?: string;
  typeOther?: string;
  time: string;
  movementDate?: string;
}

export interface DischargeAddCommandPayload extends DischargeUpdateCommandPayload {
  cribStatus?: MovementStatus;
  dischargeTarget?: DischargeTarget;
}

export interface TransferCommandPayload {
  evacuationMethod: TransferState['evacuationMethod'];
  receivingCenter: TransferState['receivingCenter'];
  receivingCenterOther: string;
  transferEscort: string;
  time: string;
  movementDate?: string;
}

export type DischargeCommand =
  | {
      kind: 'updateDischarge';
      id: string;
      payload: DischargeUpdateCommandPayload;
    }
  | {
      kind: 'addDischarge';
      bedId: string;
      payload: DischargeAddCommandPayload;
    };

export type TransferCommand =
  | {
      kind: 'updateTransfer';
      id: string;
      payload: TransferCommandPayload;
    }
  | {
      kind: 'addTransfer';
      bedId: string;
      payload: TransferCommandPayload;
    };
