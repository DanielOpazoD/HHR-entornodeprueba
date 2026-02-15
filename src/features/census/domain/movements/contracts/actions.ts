import type { DischargeData, TransferData } from '@/types';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';

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
