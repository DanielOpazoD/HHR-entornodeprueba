import {
  DEFAULT_DISCHARGE_STATUS,
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
  DischargeStatus,
  EvacuationMethod,
  ReceivingCenter,
} from '@/constants';

export type ActionType = 'move' | 'copy' | null;

export interface ActionState {
  type: ActionType;
  sourceBedId: string | null;
  targetBedId: string | null;
}

export type DischargeTarget = 'mother' | 'baby' | 'both';

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
