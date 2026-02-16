import {
  DEFAULT_DISCHARGE_STATUS,
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
  DischargeStatus,
  EvacuationMethod,
  ReceivingCenter,
} from '@/constants';
import type {
  DischargeTarget,
  MoveOrCopyActionState,
  MoveOrCopyActionType,
} from '@/features/census/domain/movements/contracts';
export type { DischargeTarget } from '@/features/census/domain/movements/contracts';

export type ActionType = MoveOrCopyActionType;
export type ActionState = MoveOrCopyActionState;

export interface DischargeState {
  bedId: string | null;
  recordId?: string;
  isOpen: boolean;
  status: DischargeStatus;
  type?: string;
  typeOther?: string;
  time?: string;
  movementDate?: string;
  hasClinicalCrib?: boolean;
  clinicalCribName?: string;
  clinicalCribStatus?: DischargeStatus;
  dischargeTarget?: DischargeTarget;
}

export interface TransferState {
  bedId: string | null;
  recordId?: string;
  isOpen: boolean;
  evacuationMethod: EvacuationMethod;
  evacuationMethodOther: string;
  receivingCenter: ReceivingCenter;
  receivingCenterOther: string;
  transferEscort: string;
  time?: string;
  movementDate?: string;
  hasClinicalCrib?: boolean;
  clinicalCribName?: string;
}

export const createInitialActionState = (): ActionState => ({
  type: null,
  sourceBedId: null,
  targetBedId: null,
});

export const createInitialDischargeState = (): DischargeState => ({
  bedId: null,
  isOpen: false,
  status: DEFAULT_DISCHARGE_STATUS,
});

export const createInitialTransferState = (): TransferState => ({
  bedId: null,
  isOpen: false,
  evacuationMethod: DEFAULT_EVACUATION_METHOD,
  evacuationMethodOther: '',
  receivingCenter: DEFAULT_RECEIVING_CENTER,
  receivingCenterOther: '',
  transferEscort: DEFAULT_TRANSFER_ESCORT,
});
