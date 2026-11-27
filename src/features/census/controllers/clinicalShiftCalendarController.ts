import {
  DEFAULT_SHIFT_SCHEDULE,
  parseTimeMinutes,
  resolveClinicalDayBounds,
} from '@/utils/clinicalDayUtils';

export const MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR = 'Fecha/hora fuera de rango para el turno.';

export interface MovementDateTimeBounds {
  minDate: string;
  maxDate: string;
  nextDay: string;
  nightEnd: string;
  nextDayMaxTime: string;
}

const formatMinutesAsTime = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const minuteBefore = (minutes: number): string => formatMinutesAsTime(Math.max(0, minutes - 1));

export const resolveMovementDateForRecordShift = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string => {
  if (!recordDate) return '';
  if (movementDate) return movementDate;

  const timeMinutes = parseTimeMinutes(movementTime);
  if (timeMinutes === null) return recordDate;

  const { nextDay, nightEndMinutes } = resolveClinicalDayBounds(recordDate);
  return timeMinutes < nightEndMinutes ? nextDay : recordDate;
};

export const resolveMovementDateTimeBounds = (recordDate: string): MovementDateTimeBounds => {
  if (!recordDate) {
    const { nightEnd } = DEFAULT_SHIFT_SCHEDULE;
    return {
      minDate: '',
      maxDate: '',
      nextDay: '',
      nightEnd,
      nextDayMaxTime: minuteBefore(parseTimeMinutes(nightEnd) ?? 0),
    };
  }

  const { nextDay, nightEnd, nightEndMinutes } = resolveClinicalDayBounds(recordDate);
  const nextDayMaxTime = minuteBefore(nightEndMinutes);

  return {
    minDate: recordDate,
    maxDate: nextDay,
    nextDay,
    nightEnd,
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

  const { nextDay, nightEndMinutes } = resolveClinicalDayBounds(recordDate);
  if (movementDate !== nextDay) return true;

  return timeMinutes < nightEndMinutes;
};

export const resolveMovementTimeInputMax = ({
  dateValue,
  nextDay,
  nextDayMaxTime,
}: {
  dateValue: string;
  nextDay: string;
  nextDayMaxTime: string;
}): string | undefined => (dateValue === nextDay ? nextDayMaxTime : undefined);

export const resolveMovementDateTimeValidationError = ({
  recordDate,
  movementDate,
  movementTime,
}: {
  recordDate: string;
  movementDate: string;
  movementTime: string;
}): string | undefined => {
  if (!recordDate || !movementDate || !movementTime) return MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR;
  return isMovementDateTimeAllowed(recordDate, movementDate, movementTime)
    ? undefined
    : MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR;
};

export const resolveMovementEditorInitialDate = (
  recordDate: string,
  movementDate?: string,
  movementTime?: string
): string =>
  resolveMovementDateForRecordShift(recordDate, movementDate, movementTime) || recordDate;
