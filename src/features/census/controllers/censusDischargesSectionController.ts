import type { DischargeData } from '@/types';
import { resolveMovementSectionState } from '@/features/census/controllers/censusMovementSectionController';

export interface DischargesSectionState {
  isRenderable: boolean;
  isEmpty: boolean;
  discharges: DischargeData[];
}

export const resolveDischargesSectionState = (
  discharges: DischargeData[] | null | undefined
): DischargesSectionState => {
  const state = resolveMovementSectionState(discharges);

  return {
    isRenderable: state.isRenderable,
    isEmpty: state.isEmpty,
    discharges: state.items,
  };
};
