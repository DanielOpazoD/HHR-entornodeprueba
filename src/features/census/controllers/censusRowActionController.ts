import { CensusManager } from '@/domain/CensusManager';
import { DEFAULT_EVACUATION_METHOD, DEFAULT_RECEIVING_CENTER } from '@/constants';
import { PatientData } from '@/types';
import { StabilityRules } from '@/hooks/useStabilityRules';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import {
  ControllerError,
  ControllerResult,
  failWithCode,
  ok,
} from '@/features/census/controllers/controllerResult';
import type { RowActionCommand } from '@/features/census/types/censusRowActionCommandTypes';
export type {
  RowActionCommand,
  RowActionConfirmDescriptor,
} from '@/features/census/types/censusRowActionCommandTypes';

export type RowActionErrorCode = 'ACTIONS_LOCKED' | 'PATIENT_NAME_REQUIRED';

export type RowActionError = ControllerError<RowActionErrorCode>;

export type RowActionResult = ControllerResult<
  RowActionCommand,
  RowActionErrorCode,
  RowActionError
>;

interface ResolveRowActionParams {
  action: PatientRowAction;
  bedId: string;
  patient: PatientData;
  stabilityRules: StabilityRules;
}

export const resolveRowActionCommand = ({
  action,
  bedId,
  patient,
  stabilityRules,
}: ResolveRowActionParams): RowActionResult => {
  if (!stabilityRules.canPerformActions) {
    return failWithCode(
      'ACTIONS_LOCKED',
      stabilityRules.lockReason || 'Este registro está bloqueado para ediciones.'
    );
  }

  switch (action) {
    case 'clear':
      return ok({
        kind: 'confirmClear',
        bedId,
        confirm: {
          title: 'Limpiar cama',
          message: '¿Está seguro de limpiar los datos de esta cama?',
          confirmText: 'Sí, limpiar',
          variant: 'warning',
        },
      });

    case 'copy':
    case 'move':
      return ok({
        kind: 'setMovement',
        nextActionState: { type: action, sourceBedId: bedId, targetBedId: null },
      });

    case 'discharge':
      return ok({
        kind: 'openDischarge',
        dischargePatch: CensusManager.prepareDischarge(patient, bedId),
      });

    case 'transfer':
      return ok({
        kind: 'openTransfer',
        transferPatch: CensusManager.prepareTransfer(patient, bedId, {
          evacuation: DEFAULT_EVACUATION_METHOD,
          center: DEFAULT_RECEIVING_CENTER,
        }),
      });

    case 'cma':
      if (!patient.patientName) {
        return failWithCode('PATIENT_NAME_REQUIRED', 'No hay paciente para registrar egreso CMA.');
      }
      return ok({
        kind: 'confirmCma',
        bedId,
        cmaData: CensusManager.formatCMAData(patient, bedId),
        confirm: {
          title: 'Egreso CMA',
          message: `¿Registrar a ${patient.patientName} como egreso de Hospitalización Diurna (CMA)?`,
          variant: 'warning',
        },
      });
  }
};
