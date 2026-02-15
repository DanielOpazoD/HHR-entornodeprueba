import type { CMAData, DischargeData, ShiftType, TransferData } from '@/types';
import { isWithinDayShift } from '@/utils/dateUtils';

interface ShiftMovement {
  time?: string;
}

export const isMovementInSelectedShift = (
  movement: ShiftMovement,
  selectedShift: ShiftType
): boolean => {
  // Legacy entries without time are interpreted as day-shift records.
  if (!movement.time) {
    return selectedShift === 'day';
  }

  const isDayTime = isWithinDayShift(movement.time);
  return selectedShift === 'day' ? isDayTime : !isDayTime;
};

export const filterDischargesByShift = (
  discharges: DischargeData[] | undefined,
  selectedShift: ShiftType
): DischargeData[] =>
  (discharges || []).filter(discharge => isMovementInSelectedShift(discharge, selectedShift));

export const filterTransfersByShift = (
  transfers: TransferData[] | undefined,
  selectedShift: ShiftType
): TransferData[] =>
  (transfers || []).filter(transfer => isMovementInSelectedShift(transfer, selectedShift));

export const filterCmaByShift = (
  cma: CMAData[] | undefined,
  selectedShift: ShiftType
): CMAData[] => (selectedShift === 'night' ? [] : cma || []);
