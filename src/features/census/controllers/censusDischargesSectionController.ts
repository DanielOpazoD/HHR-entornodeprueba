import type { DischargeData } from '@/types';
import { resolveDischargeTimeUpdateCommand } from '@/features/census/controllers/censusDischargesTableController';
import type { UpdateDischargeAction } from '@/features/census/types/patientMovementCommandTypes';

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

export const executeDischargeTimeChangeController = (
  discharges: DischargeData[],
  id: string,
  newTime: string,
  updateDischarge: UpdateDischargeAction
): boolean => {
  const command = resolveDischargeTimeUpdateCommand(discharges, id, newTime);
  if (!command) {
    return false;
  }

  updateDischarge(
    command.id,
    command.status,
    command.dischargeType,
    command.dischargeTypeOther,
    command.time
  );

  return true;
};
