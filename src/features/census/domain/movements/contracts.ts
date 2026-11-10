import type {
  CensusActionValidationError,
  CensusActionValidationErrorCode,
} from '@/features/census/validation/censusActionValidation';
import type {
  DischargeMovementActions,
  DischargeTarget,
  MovementStatus,
  TransferMovementActions,
} from '@/types/movements';

export type MoveOrCopyActionType = 'move' | 'copy' | null;

export interface MoveOrCopyActionState {
  type: MoveOrCopyActionType;
  sourceBedId: string | null;
  targetBedId: string | null;
}

export interface DischargeExecutionInput {
  status: MovementStatus;
  type?: string;
  typeOther?: string;
  time?: string;
  movementDate?: string;
  dischargeTarget?: DischargeTarget;
  diagnosis?: string;
}

export interface TransferExecutionInput {
  time?: string;
  movementDate?: string;
  diagnosis?: string;
}

export interface DischargeUpdateCommandPayload {
  status: MovementStatus;
  type?: string;
  typeOther?: string;
  time: string;
  movementDate?: string;
  diagnosis?: string;
}

export interface DischargeAddCommandPayload extends DischargeUpdateCommandPayload {
  cribStatus?: MovementStatus;
  dischargeTarget?: DischargeTarget;
}

export interface TransferCommandPayload {
  evacuationMethod: string;
  receivingCenter: string;
  receivingCenterOther: string;
  transferEscort: string;
  time: string;
  movementDate?: string;
  diagnosis?: string;
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

export interface MoveOrCopyRuntimeActions {
  moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;
  copyPatientToDate: (bedId: string, targetDate: string, targetBedId?: string) => Promise<void>;
}

export type DischargeRuntimeActions = Pick<
  DischargeMovementActions,
  'addDischarge' | 'updateDischarge'
>;

export type TransferRuntimeActions = Pick<
  TransferMovementActions,
  'addTransfer' | 'updateTransfer'
>;
