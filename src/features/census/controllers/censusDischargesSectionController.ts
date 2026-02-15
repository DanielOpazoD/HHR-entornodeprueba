import type { DischargeData } from '@/types';

export interface DischargesSectionState {
  isRenderable: boolean;
  isEmpty: boolean;
  discharges: DischargeData[];
}

export const resolveDischargesSectionState = (
  discharges: DischargeData[] | null | undefined
): DischargesSectionState => {
  if (discharges === null) {
    return {
      isRenderable: false,
      isEmpty: true,
      discharges: [],
    };
  }

  const safeDischarges = discharges || [];

  return {
    isRenderable: true,
    isEmpty: safeDischarges.length === 0,
    discharges: safeDischarges,
  };
};
