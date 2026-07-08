import type { DischargeStatus } from '@/constants/clinicalMovementConstants';
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
  diagnosis?: string;
}

export interface TransferModalConfirmPayload extends MovementDateTimeCommandPayload {
  diagnosis?: string;
}
