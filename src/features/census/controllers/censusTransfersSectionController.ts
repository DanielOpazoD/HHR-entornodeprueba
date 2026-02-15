import type { TransferData } from '@/types';

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
