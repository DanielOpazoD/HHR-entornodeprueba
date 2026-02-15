import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import {
  isMovementDateAllowed,
  isMovementDateTimeAllowed,
  MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR,
  resolveMovementDateForRecordShift,
  resolveMovementDateTimeBounds,
  resolveMovementDateTimeValidationError,
  resolveMovementEditorInitialDate,
  resolveMovementTimeInputMax,
} from '@/features/census/controllers/clinicalShiftCalendarController';

export const MOVEMENT_TIME_FALLBACK = '--:--';

/**
 * Resolves the effective calendar date for a movement entry.
 * Movements between 00:00 and configured night end (08:00 or 09:00) are
 * considered madrugada of the next day for display purposes.
 */
export const resolveMovementDisplayDate = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string => resolveMovementDateForRecordShift(recordDate, movementDate, movementTime);

export const resolveMovementDisplayDateLabel = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string => {
  const resolvedDate = resolveMovementDisplayDate(recordDate, movementDate, movementTime);
  if (!resolvedDate) return '-';
  return formatDateDDMMYYYY(resolvedDate);
};

export const resolveMovementDisplayTimeLabel = (movementTime?: string): string =>
  movementTime || MOVEMENT_TIME_FALLBACK;

export interface MovementDateTimeDisplayValue {
  timeLabel: string;
  dateLabel: string;
}

export const resolveMovementDateTimeDisplayValue = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): MovementDateTimeDisplayValue => ({
  timeLabel: resolveMovementDisplayTimeLabel(movementTime),
  dateLabel: resolveMovementDisplayDateLabel(recordDate, movementDate, movementTime),
});
export {
  isMovementDateAllowed,
  isMovementDateTimeAllowed,
  MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR,
  resolveMovementDateTimeBounds,
  resolveMovementDateTimeValidationError,
  resolveMovementEditorInitialDate,
  resolveMovementTimeInputMax,
};
