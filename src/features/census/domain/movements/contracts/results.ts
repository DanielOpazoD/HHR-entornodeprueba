import type { CensusActionError, MoveOrCopyRuntimeError } from './errors';
import type { MoveOrCopyActionState } from './primitives';

export type CensusActionCommandResult<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export interface MoveOrCopyRuntimeSuccess {
  nextActionState: MoveOrCopyActionState;
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
