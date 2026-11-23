import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type { ActionState, DischargeState, TransferState } from '@/domain/censusActionContracts';
import { createInitialActionState } from '@/domain/censusActionContracts';
import { resolveDischargeCommand } from '@/features/census/controllers/censusDischargeCommandController';
import { resolveMoveOrCopyCommand } from '@/features/census/controllers/censusMoveOrCopyCommandController';
import { resolveTransferCommand } from '@/features/census/controllers/censusTransferCommandController';
import { failWithCode, ok } from '@/shared/contracts/controllerResult';
import type {
  DischargeCommand,
  DischargeRuntimeActions,
  DischargeExecutionInput,
  DischargeRuntimeResult,
  MoveOrCopyRuntimeActions,
  MoveOrCopyRuntimeResult,
  TransferCommand,
  TransferRuntimeActions,
  TransferExecutionInput,
  TransferRuntimeResult,
} from '@/features/census/domain/movements/contracts';

export const executeDischargeRuntimeCommand = (
  command: DischargeCommand,
  actions: DischargeRuntimeActions
): void => {
  if (command.kind === 'addDischarge') {
    actions.addDischarge(command.bedId, command.payload);
    return;
  }

  const { status, type, typeOther, time, movementDate, diagnosis } = command.payload;
  actions.updateDischarge(
    command.id,
    status,
    type,
    typeOther,
    time,
    movementDate,
    undefined,
    diagnosis
  );
};

export const executeTransferRuntimeCommand = (
  command: TransferCommand,
  actions: TransferRuntimeActions
): void => {
  if (command.kind === 'addTransfer') {
    actions.addTransfer(command.bedId, command.payload);
    return;
  }

  actions.updateTransfer(command.id, command.payload);
};

interface ExecuteMoveOrCopyParams {
  actionState: ActionState;
  record: DailyRecord | null;
  targetDate?: string;
  actions: MoveOrCopyRuntimeActions;
}

interface ExecuteDischargeParams {
  dischargeState: DischargeState;
  data?: DischargeExecutionInput;
  stabilityRules: StabilityRules;
  nowTime: string;
  actions: DischargeRuntimeActions;
}

interface ExecuteTransferParams {
  transferState: TransferState;
  data?: TransferExecutionInput;
  stabilityRules: StabilityRules;
  nowTime: string;
  actions: TransferRuntimeActions;
}

export const executeMoveOrCopyController = async ({
  actionState,
  record,
  targetDate,
  actions,
}: ExecuteMoveOrCopyParams): Promise<MoveOrCopyRuntimeResult> => {
  const resolution = resolveMoveOrCopyCommand({ actionState, record, targetDate });
  if (!resolution.ok) {
    return resolution;
  }

  const command = resolution.value;
  if (command.kind === 'copyToDate') {
    try {
      await actions.copyPatientToDate(command.sourceBedId, command.targetDate, command.targetBedId);
    } catch {
      return failWithCode(
        'COPY_TO_DATE_FAILED',
        'No se pudo copiar el paciente a la fecha seleccionada.'
      );
    }
  } else {
    actions.moveOrCopyPatient(command.movementType, command.sourceBedId, command.targetBedId);
  }

  return ok({
    nextActionState: createInitialActionState(),
  });
};

export const executeDischargeController = ({
  dischargeState,
  data,
  stabilityRules,
  nowTime,
  actions,
}: ExecuteDischargeParams): DischargeRuntimeResult => {
  const resolution = resolveDischargeCommand({
    dischargeState,
    data,
    stabilityRules,
    nowTime,
  });
  if (!resolution.ok) {
    return resolution;
  }

  executeDischargeRuntimeCommand(resolution.value, actions);

  return ok({
    closeModalPatch: { isOpen: false },
  });
};

export const executeTransferController = ({
  transferState,
  data,
  stabilityRules,
  nowTime,
  actions,
}: ExecuteTransferParams): TransferRuntimeResult => {
  const resolution = resolveTransferCommand({
    transferState,
    data,
    stabilityRules,
    nowTime,
  });
  if (!resolution.ok) {
    return resolution;
  }

  executeTransferRuntimeCommand(resolution.value, actions);

  return ok({
    closeModalPatch: { isOpen: false },
  });
};
