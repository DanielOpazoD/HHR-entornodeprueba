import { CensusManager } from '@/domain/CensusManager';
import {
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
} from '@/constants/clinicalMovementConstants';
import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
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

export type RowActionErrorCode =
  | 'ACTIONS_LOCKED'
  | 'PATIENT_NAME_REQUIRED'
  | 'PERSISTENCE_FAILED'
  | 'EPISODE_REQUIRED'
  | 'CLINICAL_CRIB_ATTACHED'
  | 'PREVIOUS_DAY_PENDING';

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
          message: patient.clinicalCrib
            ? '¿Está seguro de limpiar los datos de esta cama y de su cuna asociada?'
            : '¿Está seguro de limpiar los datos de esta cama?',
          confirmText: 'Sí, limpiar',
          variant: 'warning',
        },
      });

    case 'invalid': {
      const clinicalEpisodeId = patient.clinicalEpisodeId?.trim();
      if (!clinicalEpisodeId) {
        return failWithCode(
          'EPISODE_REQUIRED',
          'Solo un paciente con episodio de Eloísa se marca como no válido. Usa «Limpiar».'
        );
      }
      // The newborn is another person (ID-03): never remove it with its mother's episode.
      if (patient.clinicalCrib) {
        return failWithCode(
          'CLINICAL_CRIB_ATTACHED',
          'Esta cama tiene una cuna asociada. Mueve o limpia la cuna antes de marcar al paciente como no válido.'
        );
      }
      return ok({
        kind: 'confirmInvalid',
        bedId,
        clinicalEpisodeId,
        confirm: {
          title: 'Paciente no válido',
          message:
            'Úsalo solo para un ingreso creado por error, por ejemplo un doble ingreso. El paciente se elimina del censo, no cuenta en las estadísticas y la sincronización con Eloísa no lo volverá a ingresar ni registrará su egreso. Un reingreso real tiene otro episodio y no se ve afectado.',
          confirmText: 'Sí, eliminar',
          variant: 'danger',
        },
      });
    }

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
