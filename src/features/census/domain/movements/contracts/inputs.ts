import type { DischargeTarget } from '@/features/census/types/censusActionTypes';

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
