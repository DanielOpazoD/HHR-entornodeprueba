import type { TransferData } from '@/features/census/contracts/censusMovementContracts';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';
import { buildMovementRowActions } from '@/features/census/controllers/censusMovementRowActionsController';

export const TRANSFERS_TABLE_HEADERS: readonly CensusMovementTableHeader[] = [
  { label: 'Cama Origen' },
  { label: 'Paciente' },
  { label: 'RUT / ID' },
  { label: 'Diagnóstico' },
  { label: 'Medio' },
  { label: 'Centro Destino' },
  { label: 'Fecha / Hora', className: 'text-center' },
  { label: 'Acciones', className: 'text-right print:hidden' },
] as const;

export const getTransferCenterLabel = (transfer: TransferData): string =>
  transfer.receivingCenter === 'Otro'
    ? transfer.receivingCenterOther || ''
    : transfer.receivingCenter;

export const getTransferEscortLabel = (transfer: TransferData): string | null => {
  if (!transfer.transferEscort || transfer.evacuationMethod === 'Aerocardal') {
    return null;
  }

  return `Acompaña: ${transfer.transferEscort}`;
};

interface TransferRowActionHandlers {
  undoTransfer: (id: string) => void;
  editTransfer: (transfer: TransferData) => void;
  deleteTransfer: (id: string) => void;
  convertTransferToHomeDischarge?: (id: string) => void;
  convertTransferToCma?: (id: string) => void;
}

export const buildTransferRowActions = (
  transfer: TransferData,
  handlers: TransferRowActionHandlers
) => {
  const [undoAction, editAction, deleteAction] = buildMovementRowActions(transfer, {
    onUndo: handlers.undoTransfer,
    onEdit: handlers.editTransfer,
    onDelete: handlers.deleteTransfer,
  });
  const actions = [undoAction, editAction];
  if (handlers.convertTransferToHomeDischarge) {
    actions.push({
      kind: 'convert' as const,
      title: 'Convertir a alta domicilio',
      className: 'text-orange-500 hover:text-orange-700',
      onClick: () => void handlers.convertTransferToHomeDischarge?.(transfer.id),
    });
  }
  if (handlers.convertTransferToCma) {
    actions.push({
      kind: 'convert' as const,
      title: 'Convertir a CMA',
      className: 'text-orange-500 hover:text-orange-700',
      onClick: () => void handlers.convertTransferToCma?.(transfer.id),
    });
  }
  actions.push(deleteAction);
  return actions;
};
