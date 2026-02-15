import type { TransferData } from '@/types';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';

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

export interface TransferTimeUpdateCommand {
  id: string;
  updates: {
    evacuationMethod: TransferData['evacuationMethod'];
    receivingCenter: TransferData['receivingCenter'];
    receivingCenterOther: TransferData['receivingCenterOther'];
    transferEscort: TransferData['transferEscort'];
    movementDate?: TransferData['movementDate'];
    time: string;
  };
}

export const resolveTransferTimeUpdateCommand = (
  transfers: TransferData[],
  transferId: string,
  newTime: string,
  movementDate?: string
): TransferTimeUpdateCommand | null => {
  const transfer = transfers.find(entry => entry.id === transferId);
  if (!transfer) {
    return null;
  }

  return {
    id: transfer.id,
    updates: {
      evacuationMethod: transfer.evacuationMethod,
      receivingCenter: transfer.receivingCenter,
      receivingCenterOther: transfer.receivingCenterOther,
      transferEscort: transfer.transferEscort,
      movementDate: movementDate ?? transfer.movementDate,
      time: newTime,
    },
  };
};

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
): CensusMovementActionDescriptor[] => {
  return [
    {
      kind: 'undo',
      title: 'Deshacer (Restaurar a Cama)',
      className: 'text-slate-400 hover:text-slate-600',
      onClick: () => handlers.undoTransfer(transfer.id),
    },
    {
      kind: 'edit',
      title: 'Editar',
      className: 'text-medical-500 hover:text-medical-700',
      onClick: () => handlers.editTransfer(transfer),
    },
    {
      kind: 'delete',
      title: 'Eliminar Registro',
      className: 'text-red-400 hover:text-red-600',
      onClick: () => handlers.deleteTransfer(transfer.id),
    },
  ];
};
