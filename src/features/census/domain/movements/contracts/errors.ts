import type {
  CensusActionValidationError,
  CensusActionValidationErrorCode,
} from '@/features/census/validation/censusActionValidation';

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
