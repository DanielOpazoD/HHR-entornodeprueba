import type { PatientData } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import {
  type RowActionError,
  type RowActionErrorCode,
  resolveRowActionCommand,
} from '@/features/census/controllers/censusRowActionController';
import { type ControllerResult, ok } from '@/features/census/controllers/controllerResult';
import type {
  RowActionRuntimeActions,
  RowActionRuntimeConfirm,
} from '@/features/census/types/censusRowActionRuntimeTypes';

export interface RowActionRuntimeSuccess {
  applied: boolean;
}

export type RowActionRuntimeResult = ControllerResult<
  RowActionRuntimeSuccess,
  RowActionErrorCode,
  RowActionError
>;

interface ExecuteRowActionParams {
  action: PatientRowAction;
  bedId: string;
  patient: PatientData;
  stabilityRules: StabilityRules;
  actions: RowActionRuntimeActions;
  confirmRuntime: RowActionRuntimeConfirm;
}

export const executeRowActionController = async ({
  action,
  bedId,
  patient,
  stabilityRules,
  actions,
  confirmRuntime,
}: ExecuteRowActionParams): Promise<RowActionRuntimeResult> => {
  const resolution = resolveRowActionCommand({ action, bedId, patient, stabilityRules });
  if (!resolution.ok) {
    return resolution;
  }

  const command = resolution.value;
  switch (command.kind) {
    case 'confirmClear': {
      const isConfirmed = await confirmRuntime.confirm(command.confirm);
      if (!isConfirmed) {
        return ok({ applied: false });
      }
      actions.clearPatient(command.bedId);
      return ok({ applied: true });
    }
    case 'setMovement':
      actions.setMovement(command.nextActionState);
      return ok({ applied: true });
    case 'openDischarge':
      actions.openDischarge(command.dischargePatch);
      return ok({ applied: true });
    case 'openTransfer':
      actions.openTransfer(command.transferPatch);
      return ok({ applied: true });
    case 'confirmCma': {
      const isConfirmed = await confirmRuntime.confirm(command.confirm);
      if (!isConfirmed) {
        return ok({ applied: false });
      }
      actions.addCMA(command.cmaData);
      actions.clearPatient(command.bedId);
      return ok({ applied: true });
    }
  }
};
