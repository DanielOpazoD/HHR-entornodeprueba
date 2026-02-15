import type { TransferData } from '@/types';
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
}

export const buildTransferRowActions = (
  transfer: TransferData,
  handlers: TransferRowActionHandlers
) =>
  buildMovementRowActions(transfer, {
    onUndo: handlers.undoTransfer,
    onEdit: handlers.editTransfer,
    onDelete: handlers.deleteTransfer,
  });
