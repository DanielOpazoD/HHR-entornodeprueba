import type { ActionState } from '@/features/census/types/censusActionTypes';

import type { CensusActionError, MoveOrCopyRuntimeError } from './errors';

export type CensusActionCommandResult<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export interface MoveOrCopyRuntimeSuccess {
  nextActionState: ActionState;
}

export interface ModalCloseSuccess {
  closeModalPatch: { isOpen: false };
}

export type MoveOrCopyRuntimeResult = CensusActionCommandResult<
  MoveOrCopyRuntimeSuccess,
  MoveOrCopyRuntimeError
>;

export type DischargeRuntimeResult = CensusActionCommandResult<
  ModalCloseSuccess,
  CensusActionError
>;

export type TransferRuntimeResult = CensusActionCommandResult<ModalCloseSuccess, CensusActionError>;
