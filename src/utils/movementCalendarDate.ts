import type { DischargeData, TransferData } from '@/types/domain/movements';
import { parseTimeMinutes, resolveClinicalDayBounds } from './clinicalDayScheduleUtils';

/** A census owns a nursing shift; its early-morning movements occur on the next calendar day. */
export const calendarDateForMovement = (censusDate: string, time?: string): string => {
  const minutes = parseTimeMinutes(time);
  if (!censusDate || minutes === null) return censusDate;
  const { nextDay, nightEndMinutes } = resolveClinicalDayBounds(censusDate);
  return minutes < nightEndMinutes ? nextDay : censusDate;
};

/** Older imports persisted the census day as movementDate. Recover only that known source defect. */
export const recoverImportedMovementCalendarDate = <T extends DischargeData | TransferData>(
  movement: T,
  censusDate: string
): T => {
  if (
    movement.movementProvenance?.source !== 'gestion_camas' ||
    movement.movementDate !== censusDate
  )
    return movement;
  const calendarDate = calendarDateForMovement(censusDate, movement.time);
  return calendarDate === censusDate ? movement : { ...movement, movementDate: calendarDate };
};
