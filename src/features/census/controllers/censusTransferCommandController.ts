import { StabilityRules } from '@/hooks/useStabilityRules';
import type { TransferState } from '@/features/census/types/censusActionTypes';
import {
  normalizeOptionalText,
  validateTransferExecutionInput,
} from '@/features/census/validation/censusActionValidation';
import { fail, failWithCode, ok } from '@/features/census/controllers/controllerResult';
import type {
  CensusActionError,
  CensusActionCommandResult,
  TransferCommand,
  TransferExecutionInput,
} from '@/features/census/domain/movements/contracts';

type CensusControllerResult<TValue> = CensusActionCommandResult<TValue, CensusActionError>;

interface ResolveTransferParams {
  transferState: TransferState;
  data?: TransferExecutionInput;
  stabilityRules: StabilityRules;
  nowTime: string;
}

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
  const diagnosis =
    data?.diagnosis !== undefined
      ? normalizeOptionalText(data.diagnosis)
      : normalizeOptionalText(transferState.diagnosis);

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
    diagnosis,
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
