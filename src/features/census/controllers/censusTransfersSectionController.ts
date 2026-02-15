import type { TransferData } from '@/types';
import { resolveMovementSectionState } from '@/features/census/controllers/censusMovementSectionController';

export interface TransfersSectionState {
  isRenderable: boolean;
  isEmpty: boolean;
  transfers: TransferData[];
}

export const resolveTransfersSectionState = (
  transfers: TransferData[] | null | undefined
): TransfersSectionState => {
  const state = resolveMovementSectionState(transfers);

  return {
    isRenderable: state.isRenderable,
    isEmpty: state.isEmpty,
    transfers: state.items,
  };
};
