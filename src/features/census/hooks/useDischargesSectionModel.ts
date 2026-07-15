import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useCensusActionCommands } from '../context/censusActionContexts';
import { useCensusMovementData } from './useCensusMovementData';
import { useMovementSectionModel } from './useMovementSectionModel';
import {
  buildMovementTypeConversionConfirmDialog,
  DISCHARGE_DELETE_CONFIRM_DIALOG,
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

  return {
    recordDate,
    sectionModel,
    handleEditDischarge,
    updateDischarge,
    handleConvertDischargeToCma,
    handleConvertDischargeToTransfer,
  };
};
