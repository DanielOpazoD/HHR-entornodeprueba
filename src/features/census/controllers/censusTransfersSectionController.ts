import type { TransferData } from '@/types';
import { resolveTransferTimeUpdateCommand } from '@/features/census/controllers/censusTransfersTableController';
import type { UpdateTransferAction } from '@/features/census/types/patientMovementCommandTypes';

export interface TransfersSectionState {
  isRenderable: boolean;
  isEmpty: boolean;
  transfers: TransferData[];
}

export const resolveTransfersSectionState = (
  transfers: TransferData[] | null | undefined
): TransfersSectionState => {
  if (transfers === null) {
    return {
      isRenderable: false,
      isEmpty: true,
      transfers: [],
    };
  }

  const safeTransfers = transfers || [];

  return {
    isRenderable: true,
    isEmpty: safeTransfers.length === 0,
    transfers: safeTransfers,
  };
};

export const executeTransferTimeChangeController = (
  transfers: TransferData[],
  id: string,
  newTime: string,
  updateTransfer: UpdateTransferAction
): boolean => {
  const command = resolveTransferTimeUpdateCommand(transfers, id, newTime);
  if (!command) {
    return false;
  }

  updateTransfer(command.id, command.updates);
  return true;
};
