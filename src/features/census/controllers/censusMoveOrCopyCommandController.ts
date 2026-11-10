import { CensusManager } from '@/domain/CensusManager';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { failWithCode, ok } from '@/features/census/controllers/controllerResult';
import type { ActionState } from '@/domain/censusActionContracts';
import type {
  CensusActionError,
  CensusActionCommandResult,
  MoveOrCopyCommand,
} from '@/features/census/domain/movements/contracts';

type CensusControllerResult<TValue> = CensusActionCommandResult<TValue, CensusActionError>;

interface ResolveMoveOrCopyParams {
  actionState: ActionState;
  record: DailyRecord | null;
  targetDate?: string;
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
