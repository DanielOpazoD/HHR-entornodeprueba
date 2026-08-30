import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
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
import {
  buildConfirmedAssociatedCribIdentity,
  buildConfirmedBedOccupantIdentity,
} from '@/hooks/controllers/intentionalBedClearController';

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
  confirmedLastUpdated?: string;
}

export const executeRowActionController = async ({
  action,
  bedId,
  patient,
  stabilityRules,
  actions,
  confirmRuntime,
  confirmedLastUpdated,
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
      const confirmedAssociatedCrib = patient.clinicalCrib
        ? buildConfirmedAssociatedCribIdentity(patient.clinicalCrib)
        : null;
      if (confirmedAssociatedCrib?.presenceOnly && !confirmedLastUpdated) {
        return {
          ok: false,
          error: {
            code: 'PERSISTENCE_FAILED',
            message:
              'No fue posible confirmar la versión de la cuna asociada. Recargue el censo antes de limpiar la cama.',
          },
        };
      }
      const persisted = await actions.clearPatient(
        command.bedId,
        confirmedLastUpdated,
        buildConfirmedBedOccupantIdentity(patient),
        confirmedAssociatedCrib
      );
      if (!persisted) {
        return {
          ok: false,
          error: {
            code: 'PERSISTENCE_FAILED',
            message:
              'No fue posible confirmar la limpieza de la cama. Los datos vigentes se conservaron.',
          },
        };
      }
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
      return ok({ applied: true });
    }
  }
};
