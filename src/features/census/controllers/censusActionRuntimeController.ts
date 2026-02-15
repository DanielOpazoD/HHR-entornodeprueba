import type { DailyRecord } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';
import { createInitialActionState } from '@/features/census/types/censusActionTypes';
import {
  resolveDischargeCommand,
  resolveMoveOrCopyCommand,
  resolveTransferCommand,
} from '@/features/census/controllers/censusActionExecutionController';
import { failWithCode, ok } from '@/features/census/controllers/controllerResult';
import {
  executeDischargeRuntimeCommand,
  executeTransferRuntimeCommand,
} from '@/features/census/controllers/patientMovementCommandRuntimeController';
import type {
  DischargeExecutionInput,
  DischargeMovementActions,
  DischargeRuntimeResult,
  MoveOrCopyRuntimeResult,
  TransferExecutionInput,
  TransferMovementActions,
  TransferRuntimeResult,
} from '@/features/census/types/censusActionCommandContracts';

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
