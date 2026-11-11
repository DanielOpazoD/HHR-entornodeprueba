import type { CMAData } from '@/types/domain/movements';
import { resolveMovementSectionState } from '@/features/census/controllers/censusMovementSectionController';

export interface CmaSectionState {
  isRenderable: boolean;
  isEmpty: boolean;
  cma: CMAData[];
}

export const resolveCmaSectionState = (cma: CMAData[] | null | undefined): CmaSectionState => {
  const state = resolveMovementSectionState(cma);

  return {
    isRenderable: state.isRenderable,
    isEmpty: state.isEmpty,
    cma: state.items,
  };
};
