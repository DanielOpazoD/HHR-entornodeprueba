import { formatDateDDMMYYYY, getShiftSchedule } from '@/utils/dateUtils';

const parseTimeMinutes = (time?: string): number | null => {
  if (!time) return null;
  const [hourPart = '', minutePart = ''] = time.trim().split(':');
  const hour = parseInt(hourPart, 10);
  const minute = parseInt(minutePart, 10);

  if (isNaN(hour) || isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
};

const getNextDay = (recordDate: string): string => {
  const date = new Date(`${recordDate}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

const formatMinutesAsTime = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

/**
 * Resolves the effective calendar date for a movement entry.
 * Movements between 00:00 and configured night end (08:00 or 09:00) are
 * considered madrugada of the next day for display purposes.
 */
export const resolveMovementDisplayDate = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string => {
  if (!recordDate) return '';
  if (movementDate) return movementDate;

  const timeMinutes = parseTimeMinutes(movementTime);
  if (timeMinutes === null) return recordDate;

  const nightEndMinutes = parseTimeMinutes(getShiftSchedule(recordDate).nightEnd) ?? 8 * 60;
  return timeMinutes < nightEndMinutes ? getNextDay(recordDate) : recordDate;
};

export const resolveMovementDisplayDateLabel = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string => {
  const resolvedDate = resolveMovementDisplayDate(recordDate, movementDate, movementTime);
  if (!resolvedDate) return '-';
  return formatDateDDMMYYYY(resolvedDate);
};

export interface MovementDateTimeBounds {
  minDate: string;
  maxDate: string;
  nextDay: string;
  nightEnd: string;
  nextDayMaxTime: string;
}

export const resolveMovementDateTimeBounds = (recordDate: string): MovementDateTimeBounds => {
  if (!recordDate) {
    return {
      minDate: '',
      maxDate: '',
      nextDay: '',
      nightEnd: '08:00',
      nextDayMaxTime: '07:59',
    };
  }

  const nextDay = getNextDay(recordDate);
  const nightEndMinutes = parseTimeMinutes(getShiftSchedule(recordDate).nightEnd) ?? 8 * 60;
  const nextDayMaxTime = formatMinutesAsTime(Math.max(0, nightEndMinutes - 1));

  return {
    minDate: recordDate,
    maxDate: nextDay,
    nextDay,
    nightEnd: formatMinutesAsTime(nightEndMinutes),
    nextDayMaxTime,
  };
};

export const isMovementDateAllowed = (recordDate: string, movementDate: string): boolean => {
  if (!recordDate || !movementDate) return false;
  const { minDate, maxDate } = resolveMovementDateTimeBounds(recordDate);
  return movementDate === minDate || movementDate === maxDate;
};

export const isMovementDateTimeAllowed = (
  recordDate: string,
  movementDate: string,
  movementTime: string
): boolean => {
  if (!isMovementDateAllowed(recordDate, movementDate)) return false;
  const timeMinutes = parseTimeMinutes(movementTime);
  if (timeMinutes === null) return false;

  const { nextDay, nightEnd } = resolveMovementDateTimeBounds(recordDate);
  if (movementDate !== nextDay) return true;

  const nightEndMinutes = parseTimeMinutes(nightEnd) ?? 8 * 60;
  return timeMinutes < nightEndMinutes;
};

export const resolveMovementEditorInitialDate = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string => resolveMovementDisplayDate(recordDate, movementDate, movementTime) || recordDate;
