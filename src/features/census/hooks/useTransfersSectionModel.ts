import { useDailyRecordMovementActions } from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { useCensusActionCommands } from '../context/censusActionContexts';
import { useCensusMovementData } from './useCensusMovementData';
import { useMovementSectionModel } from './useMovementSectionModel';
import {
  buildMovementTypeConversionConfirmDialog,
  TRANSFER_DELETE_CONFIRM_DIALOG,
  TRANSFER_UNDO_CONFIRM_DIALOG,
} from '../controllers/censusMovementActionConfirmController';

export const useTransfersSectionModel = () => {
  const { recordDate, transfers } = useCensusMovementData();
  const { undoTransfer, deleteTransfer, convertTransferToHomeDischarge, convertTransferToCma } =
    useDailyRecordMovementActions();
  const { handleEditTransfer } = useCensusActionCommands();
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();
  const sectionModel = useMovementSectionModel({
    items: transfers,
    undoDialog: TRANSFER_UNDO_CONFIRM_DIALOG,
    undoErrorTitle: 'No se pudo deshacer traslado',
    onUndo: undoTransfer,
    deleteDialog: TRANSFER_DELETE_CONFIRM_DIALOG,
    deleteErrorTitle: 'No se pudo eliminar traslado',
    onDelete: deleteTransfer,
  });

  const runConversion = async (
    target: 'alta domicilio' | 'CMA',
    convert: (id: string) => void,
    id: string
  ) => {
    try {
      if (await confirm(buildMovementTypeConversionConfirmDialog('traslado', target))) convert(id);
    } catch {
      notifyError('No se pudo convertir', 'No se pudo confirmar el cambio de tipo de egreso.');
    }
  };

  return {
    recordDate,
    sectionModel,
    handleEditTransfer,
    handleConvertTransferToHomeDischarge: (id: string) =>
      runConversion('alta domicilio', convertTransferToHomeDischarge, id),
    handleConvertTransferToCma: (id: string) => runConversion('CMA', convertTransferToCma, id),
  };
};
