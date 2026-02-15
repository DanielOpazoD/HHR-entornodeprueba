import type { ActionState } from '@/features/census/types/censusActionTypes';
import type {
  CensusActionValidationError,
  CensusActionValidationErrorCode,
} from '@/features/census/validation/censusActionValidation';
export type {
  AddDischargeAction,
  AddTransferAction,
  DeleteDischargeAction,
  DeleteTransferAction,
  DischargeAddCommandPayload,
  DischargeCommand,
  DischargeExecutionInput,
  DischargeMovementActions,
  DischargeUpdateCommandPayload,
  MovementStatus,
  PatientMovementActions,
  TransferCommand,
  TransferCommandPayload,
  TransferExecutionInput,
  TransferMovementActions,
  UndoDischargeAction,
  UndoTransferAction,
  UpdateDischargeAction,
  UpdateTransferAction,
} from '@/features/census/types/patientMovementCommandTypes';

export type CensusActionErrorCode =
  | 'RECORD_NOT_AVAILABLE'
  | 'ACTION_TYPE_NOT_SELECTED'
  | 'BED_REFERENCE_MISSING'
  | 'MOVEMENT_VALIDATION_FAILED'
  | 'ACTIONS_LOCKED'
  | 'DISCHARGE_TARGET_MISSING'
  | 'TRANSFER_TARGET_MISSING'
  | CensusActionValidationErrorCode;

export type MoveOrCopyRuntimeErrorCode = CensusActionErrorCode | 'COPY_TO_DATE_FAILED';

export type MoveOrCopyCommand =
  | { kind: 'copyToDate'; sourceBedId: string; targetBedId: string; targetDate: string }
  | { kind: 'moveOrCopy'; movementType: 'move' | 'copy'; sourceBedId: string; targetBedId: string };

export interface CensusActionError {
  code: CensusActionErrorCode;
  message: string;
  field?: CensusActionValidationError['field'];
}

export interface MoveOrCopyRuntimeError {
  code: MoveOrCopyRuntimeErrorCode;
  message: string;
  field?: CensusActionValidationError['field'];
}

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
