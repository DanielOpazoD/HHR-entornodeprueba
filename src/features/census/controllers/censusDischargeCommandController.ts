import { StabilityRules } from '@/hooks/useStabilityRules';
import type { DischargeState } from '@/features/census/types/censusActionTypes';
import {
  normalizeOptionalText,
  validateDischargeExecutionInput,
} from '@/features/census/validation/censusActionValidation';
import { fail, failWithCode, ok } from '@/features/census/controllers/controllerResult';
import type {
  CensusActionError,
  CensusActionCommandResult,
  DischargeCommand,
  DischargeExecutionInput,
} from '@/features/census/domain/movements/contracts';

type CensusControllerResult<TValue> = CensusActionCommandResult<TValue, CensusActionError>;

interface ResolveDischargeParams {
  dischargeState: DischargeState;
  data?: DischargeExecutionInput;
  stabilityRules: StabilityRules;
  nowTime: string;
}

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
  const diagnosis =
    data?.diagnosis !== undefined
      ? normalizeOptionalText(data.diagnosis)
      : normalizeOptionalText(dischargeState.diagnosis);

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
      payload: { status, type, typeOther, time, movementDate, diagnosis },
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
      diagnosis,
    },
  });
};
