import type { DischargeStatus } from '@/constants';
import type { DischargeTarget } from './primitives';

export interface MovementDateTimeCommandPayload {
  time: string;
  movementDate?: string;
}

export interface DischargeModalConfirmPayload extends MovementDateTimeCommandPayload {
  status: DischargeStatus;
  type?: string;
  typeOther?: string;
  dischargeTarget?: DischargeTarget;
}

export type TransferModalConfirmPayload = MovementDateTimeCommandPayload;
