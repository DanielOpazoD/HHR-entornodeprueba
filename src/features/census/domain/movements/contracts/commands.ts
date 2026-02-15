import type { DischargeTarget, TransferState } from '@/features/census/types/censusActionTypes';

import type { MovementStatus } from './actions';

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

export type MoveOrCopyCommand =
  | { kind: 'copyToDate'; sourceBedId: string; targetBedId: string; targetDate: string }
  | { kind: 'moveOrCopy'; movementType: 'move' | 'copy'; sourceBedId: string; targetBedId: string };
