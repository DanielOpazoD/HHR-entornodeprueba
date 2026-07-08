import type { DischargeData, IeehData, TransferData } from '@/types/domain/movements';

export type DischargeTarget = 'mother' | 'baby' | 'both';

export type MovementStatus = DischargeData['status'];

export type AddDischargeAction = (
  bedId: string,
  status: MovementStatus,
  cribStatus?: MovementStatus,
  dischargeType?: string,
  dischargeTypeOther?: string,
  time?: string,
  target?: DischargeTarget,
  movementDate?: string
) => void;

export type UpdateDischargeAction = (
  id: string,
  status: MovementStatus,
  dischargeType?: string,
  dischargeTypeOther?: string,
  time?: string,
  movementDate?: string,
  ieehData?: IeehData,
  diagnosis?: string
) => void;

export type DeleteDischargeAction = (id: string) => void;
export type UndoDischargeAction = (id: string) => void;
export type ConvertDischargeToCmaAction = (id: string) => void;

export type AddTransferAction = (
  bedId: string,
  method: string,
  center: string,
  centerOther: string,
  escort?: string,
  time?: string,
  movementDate?: string
) => void;

export type UpdateTransferAction = (id: string, updates: Partial<TransferData>) => void;
export type DeleteTransferAction = (id: string) => void;
export type UndoTransferAction = (id: string) => void;

export interface DischargeMovementActions {
  addDischarge: AddDischargeAction;
  updateDischarge: UpdateDischargeAction;
  deleteDischarge: DeleteDischargeAction;
  undoDischarge: UndoDischargeAction;
  convertDischargeToCma: ConvertDischargeToCmaAction;
}

export interface TransferMovementActions {
  addTransfer: AddTransferAction;
  updateTransfer: UpdateTransferAction;
  deleteTransfer: DeleteTransferAction;
  undoTransfer: UndoTransferAction;
}

export type PatientMovementActions = DischargeMovementActions & TransferMovementActions;

export interface DischargeUpdateCommandPayload {
  status: MovementStatus;
  type?: string;
  typeOther?: string;
  time: string;
  movementDate?: string;
  diagnosis?: string;
}

export interface DischargeAddCommandPayload extends DischargeUpdateCommandPayload {
  cribStatus?: MovementStatus;
  dischargeTarget?: DischargeTarget;
}

export interface TransferCommandPayload {
  evacuationMethod: string;
  receivingCenter: string;
  receivingCenterOther: string;
  transferEscort: string;
  time: string;
  movementDate?: string;
  diagnosis?: string;
}

export interface MovementDateTimeCommandPayload {
  time: string;
  movementDate?: string;
}

export interface DischargeModalConfirmPayload extends MovementDateTimeCommandPayload {
  status: MovementStatus;
  type?: string;
  typeOther?: string;
  dischargeTarget?: DischargeTarget;
  diagnosis?: string;
}

export interface TransferModalConfirmPayload extends MovementDateTimeCommandPayload {
  diagnosis?: string;
}
