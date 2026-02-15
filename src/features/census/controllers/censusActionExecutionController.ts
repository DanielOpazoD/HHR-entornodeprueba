import { CensusManager } from '@/domain/CensusManager';
import { DailyRecord } from '@/types';
import { StabilityRules } from '@/hooks/useStabilityRules';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import {
  normalizeOptionalText,
  validateDischargeExecutionInput,
  validateTransferExecutionInput,
} from '@/features/census/validation/censusActionValidation';
import { fail, failWithCode, ok } from '@/features/census/controllers/controllerResult';
import type {
  CensusActionError,
  CensusActionCommandResult,
  DischargeCommand,
  DischargeExecutionInput,
  MoveOrCopyCommand,
  TransferCommand,
  TransferExecutionInput,
} from '@/features/census/types/censusActionCommandContracts';
export type {
  DischargeCommand,
  DischargeExecutionInput,
  MoveOrCopyCommand,
  TransferCommand,
  TransferExecutionInput,
} from '@/features/census/types/censusActionCommandContracts';

type CensusControllerResult<TValue> = CensusActionCommandResult<TValue, CensusActionError>;

interface ResolveMoveOrCopyParams {
  actionState: ActionState;
  record: DailyRecord | null;
  targetDate?: string;
}

interface ResolveDischargeParams {
  dischargeState: DischargeState;
  data?: DischargeExecutionInput;
  stabilityRules: StabilityRules;
  nowTime: string;
}

interface ResolveTransferParams {
  transferState: TransferState;
  data?: TransferExecutionInput;
  stabilityRules: StabilityRules;
  nowTime: string;
}

export const resolveMoveOrCopyCommand = ({
  actionState,
  record,
  targetDate,
}: ResolveMoveOrCopyParams): CensusControllerResult<MoveOrCopyCommand> => {
  if (!record) {
    return failWithCode(
      'RECORD_NOT_AVAILABLE',
      'No hay un registro activo para ejecutar el movimiento.'
    );
  }

  if (!actionState.type) {
    return failWithCode(
      'ACTION_TYPE_NOT_SELECTED',
      'Debe seleccionar mover o copiar antes de continuar.'
    );
  }

  if (!actionState.sourceBedId || !actionState.targetBedId) {
    return failWithCode('BED_REFERENCE_MISSING', 'Cama de origen o destino no especificada.');
  }

  const validation = CensusManager.validateMovement(actionState, record);
  if (!validation.isValid) {
    return failWithCode('MOVEMENT_VALIDATION_FAILED', validation.error || 'Movimiento inválido.');
  }

  if (actionState.type === 'copy' && targetDate) {
    return ok({
      kind: 'copyToDate',
      sourceBedId: actionState.sourceBedId,
      targetBedId: actionState.targetBedId,
      targetDate,
    });
  }

  return ok({
    kind: 'moveOrCopy',
    movementType: actionState.type,
    sourceBedId: actionState.sourceBedId,
    targetBedId: actionState.targetBedId,
  });
};

export const resolveDischargeCommand = ({
  dischargeState,
  data,
  stabilityRules,
  nowTime,
}: ResolveDischargeParams): CensusControllerResult<DischargeCommand> => {
  if (!stabilityRules.canPerformActions && !dischargeState.recordId) {
    return failWithCode('ACTIONS_LOCKED', stabilityRules.lockReason || 'Acción bloqueada.');
  }

  const status = data?.status || dischargeState.status;
  const type = normalizeOptionalText(data?.type) || normalizeOptionalText(dischargeState.type);
  const typeOther =
    normalizeOptionalText(data?.typeOther) || normalizeOptionalText(dischargeState.typeOther);
  const time =
    normalizeOptionalText(data?.time) || normalizeOptionalText(dischargeState.time) || nowTime;
  const movementDate =
    normalizeOptionalText(data?.movementDate) || normalizeOptionalText(dischargeState.movementDate);
  const dischargeTarget = data?.dischargeTarget || dischargeState.dischargeTarget;

  const dischargeValidationErrors = validateDischargeExecutionInput({
    status,
    type,
    typeOther,
    time,
  });
  if (dischargeValidationErrors.length > 0) {
    const [firstError] = dischargeValidationErrors;
    return fail(firstError);
  }

  if (dischargeState.recordId) {
    return ok({
      kind: 'updateDischarge',
      id: dischargeState.recordId,
      payload: { status, type, typeOther, time, movementDate },
    });
  }

  if (!dischargeState.bedId) {
    return failWithCode('DISCHARGE_TARGET_MISSING', 'No hay cama objetivo para registrar el alta.');
  }

  return ok({
    kind: 'addDischarge',
    bedId: dischargeState.bedId,
    payload: {
      status,
      cribStatus: dischargeState.clinicalCribStatus,
      type,
      typeOther,
      time,
      movementDate,
      dischargeTarget,
    },
  });
};

export const resolveTransferCommand = ({
  transferState,
  data,
  stabilityRules,
  nowTime,
}: ResolveTransferParams): CensusControllerResult<TransferCommand> => {
  if (!stabilityRules.canPerformActions && !transferState.recordId) {
    return failWithCode('ACTIONS_LOCKED', stabilityRules.lockReason || 'Acción bloqueada.');
  }

  const time =
    normalizeOptionalText(data?.time) || normalizeOptionalText(transferState.time) || nowTime;
  const movementDate =
    normalizeOptionalText(data?.movementDate) || normalizeOptionalText(transferState.movementDate);
  const evacuationMethodOther = normalizeOptionalText(transferState.evacuationMethodOther) || '';
  const receivingCenterOther = normalizeOptionalText(transferState.receivingCenterOther) || '';
  const transferEscort = normalizeOptionalText(transferState.transferEscort) || '';

  const transferValidationErrors = validateTransferExecutionInput({
    evacuationMethod: transferState.evacuationMethod,
    evacuationMethodOther,
    receivingCenter: transferState.receivingCenter,
    receivingCenterOther,
    transferEscort,
    time,
  });
  if (transferValidationErrors.length > 0) {
    const [firstError] = transferValidationErrors;
    return fail(firstError);
  }

  const payload = {
    evacuationMethod: transferState.evacuationMethod,
    receivingCenter: transferState.receivingCenter,
    receivingCenterOther,
    transferEscort,
    time,
    movementDate,
  };

  if (transferState.recordId) {
    return ok({
      kind: 'updateTransfer',
      id: transferState.recordId,
      payload,
    });
  }

  if (!transferState.bedId) {
    return failWithCode(
      'TRANSFER_TARGET_MISSING',
      'No hay cama objetivo para registrar el traslado.'
    );
  }

  return ok({
    kind: 'addTransfer',
    bedId: transferState.bedId,
    payload,
  });
};
