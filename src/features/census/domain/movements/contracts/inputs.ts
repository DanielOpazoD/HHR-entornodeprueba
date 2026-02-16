import type { DischargeTarget } from './primitives';

import type { MovementStatus } from './actions';

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
