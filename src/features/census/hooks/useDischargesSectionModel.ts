import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useCensusActionCommands } from '../context/censusActionContexts';
import { useCensusMovementData } from './useCensusMovementData';
import { useMovementSectionModel } from './useMovementSectionModel';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '../controllers/censusMovementActionConfirmController';

export const useDischargesSectionModel = () => {
  const { recordDate, discharges } = useCensusMovementData();
  const { undoDischarge, deleteDischarge, updateDischarge, convertDischargeToCma } =
    useDailyRecordMovementActions();
  const { handleEditDischarge } = useCensusActionCommands();
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();
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
        title: 'Convertir alta a CMA',
        message: '¿Convertir esta alta a un egreso CMA?',
        confirmText: 'Convertir',
        cancelText: 'Cancelar',
        variant: 'warning',
      });
    } catch {
      notifyError('No se pudo convertir', 'No se pudo confirmar el cambio de tipo de egreso.');
      return;
    }

    if (confirmed) {
      convertDischargeToCma(id);
    }
  };

  return {
    recordDate,
    sectionModel,
    handleEditDischarge,
    updateDischarge,
    handleConvertDischargeToCma,
  };
};
