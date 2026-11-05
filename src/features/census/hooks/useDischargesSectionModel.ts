import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useAuth } from '@/context/AuthContext';
import { useStabilityRules } from '@/hooks/useStabilityRules';
import { canEditAppModule } from '@/shared/access/operationalAccessPolicy';
import { isE2EEditableRecordOverrideEnabled } from '@/shared/runtime/e2eRuntime';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useCensusActionCommands } from '../context/censusActionContexts';
import { useCensusMovementData } from './useCensusMovementData';
import { useMovementSectionModel } from './useMovementSectionModel';
import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import { PREVIOUS_DAY_UNCHECKED_MESSAGE } from '@/features/census/controllers/censusActionNotificationController';
import {
  buildMovementTypeConversionConfirmDialog,
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_INVALID_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '../controllers/censusMovementActionConfirmController';

export const useDischargesSectionModel = () => {
  const { recordDate, discharges } = useCensusMovementData();
  const {
    undoDischarge,
    deleteDischarge,
    updateDischarge,
    convertDischargeToCma,
    convertDischargeToTransfer,
  } = useDailyRecordMovementActions();
  const { handleEditDischarge } = useCensusActionCommands();
  const { role } = useAuth();
  const { canPerformActions } = useStabilityRules(recordDate ? { date: recordDate } : null);
  // Same permission as «Limpiar»: a census editor, on a day still open to actions. The mark has no
  // date check of its own in the rules, so a locked or read-only day must never offer it.
  const canMarkInvalid =
    canPerformActions && (canEditAppModule(role, 'CENSUS') || isE2EEditableRecordOverrideEnabled());
  const { confirm } = useConfirmDialog();
  const { error: notifyError, warning } = useNotification();
  const sectionModel = useMovementSectionModel({
    items: discharges,
    undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
    undoErrorTitle: 'No se pudo deshacer alta',
    onUndo: undoDischarge,
    deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
    deleteErrorTitle: 'No se pudo eliminar alta',
    onDelete: deleteDischarge,
  });
  const handleConvertDischargeToCma = async (id: string) => {
    let confirmed = false;
    try {
      confirmed = await confirm({
        ...buildMovementTypeConversionConfirmDialog('alta domicilio', 'CMA'),
      });
    } catch {
      notifyError('No se pudo convertir', 'No se pudo confirmar el cambio de tipo de egreso.');
      return;
    }

    if (confirmed) {
      convertDischargeToCma(id);
    }
  };
  const handleConvertDischargeToTransfer = async (id: string) => {
    try {
      if (await confirm(buildMovementTypeConversionConfirmDialog('alta domicilio', 'traslado'))) {
        convertDischargeToTransfer(id);
      }
    } catch {
      notifyError('No se pudo convertir', 'No se pudo confirmar el cambio de tipo de egreso.');
    }
  };

  const handleMarkDischargeInvalid = async (discharge: DischargeData) => {
    const clinicalEpisodeId = discharge.clinicalEpisodeId?.trim();
    if (!canMarkInvalid || !clinicalEpisodeId) return;
    try {
      if (!(await confirm(DISCHARGE_INVALID_CONFIRM_DIALOG))) return;
    } catch {
      notifyError('No se pudo marcar como no válido', 'No se pudo confirmar la acción.');
      return;
    }
    // Mark first: once the alta is gone, only the mark keeps the sync from filing it again.
    try {
      const { markClinicalEpisodeInvalid } =
        await import('@/services/census/invalidClinicalEpisodeService');
      await markClinicalEpisodeInvalid({
        clinicalEpisodeId,
        censusDate: recordDate,
        bedId: discharge.bedId,
      });
    } catch {
      notifyError(
        'No se pudo marcar como no válido',
        'No se eliminó nada; revisa la conexión y reintenta.'
      );
      return;
    }
    deleteDischarge(discharge.id);
    let previousDay: string | null;
    try {
      const { cleanAndDescribePreviousDay } =
        await import('@/features/census/controllers/invalidEpisodePreviousDayCleanup');
      previousDay = await cleanAndDescribePreviousDay({
        censusDate: recordDate,
        clinicalEpisodeId,
      });
    } catch {
      previousDay = PREVIOUS_DAY_UNCHECKED_MESSAGE;
    }
    if (previousDay) warning('Revisar el día anterior', previousDay);
  };

  return {
    recordDate,
    sectionModel,
    handleEditDischarge,
    updateDischarge,
    handleConvertDischargeToCma,
    handleConvertDischargeToTransfer,
    handleMarkDischargeInvalid: canMarkInvalid ? handleMarkDischargeInvalid : undefined,
  };
};
