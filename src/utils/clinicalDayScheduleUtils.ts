import { CHILEAN_HOLIDAYS } from './chileanHolidays';
import { addCalendarDays } from './clinicalDateUtils';

export interface ShiftSchedule {
  dayStart: string;
  dayEnd: string;
  nightStart: string;
  nightEnd: string;
  description: string;
}

export interface ClinicalDayBounds {
  dayStart: string;
  dayStartMinutes: number;
  nextDay: string;
  nightEnd: string;
  nightEndMinutes: number;
}

/*
 * The hospital's shift hours on the Rapa Nui wall clock, written only here (the clinical clock
 * control's shift-start-literal rule). The day shift starts at 08:00 on a
 * business day and at 09:00 on a weekend or holiday; the night shift always starts at 20:00 and
 * ends when the next day's day shift starts.
 */
const BUSINESS_DAY_SHIFT_START = '08:00';
const NON_BUSINESS_DAY_SHIFT_START = '09:00';
const NIGHT_SHIFT_START = '20:00';
const BUSINESS_DAY_SHIFT_START_MINUTES = 8 * 60;
export const NIGHT_SHIFT_START_MINUTES = 20 * 60;

/** A business day's schedule, for a handoff screen or PDF that has no record date yet. */
export const DEFAULT_SHIFT_SCHEDULE: Readonly<ShiftSchedule> = {
  dayStart: BUSINESS_DAY_SHIFT_START,
  dayEnd: NIGHT_SHIFT_START,
  nightStart: NIGHT_SHIFT_START,
  nightEnd: BUSINESS_DAY_SHIFT_START,
  description: '',
};

export const parseTimeMinutes = (value?: string): number | null => {
  if (!value) return null;

  const [hourPart = '', minutePart = ''] = value.trim().split(':');
  const hour = parseInt(hourPart, 10);
  const minute = parseInt(minutePart, 10);

  if (isNaN(hour) || isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
};

/**
 * Whether a bare `HH:mm` falls in the day shift. Without a date it uses the business-day window
 * (08:00–19:59); a missing or unreadable time counts as day, like the legacy movements without one.
 */
export const isWithinDayShift = (time?: string): boolean => {
  if (!time || time.length < 5) return true;

  const timeMinutes = parseTimeMinutes(time);
  if (timeMinutes === null) return true;

  return timeMinutes >= BUSINESS_DAY_SHIFT_START_MINUTES && timeMinutes < NIGHT_SHIFT_START_MINUTES;
};

export const isBusinessDay = (dateString: string): boolean => {
  if (CHILEAN_HOLIDAYS.includes(dateString)) {
    return false;
  }

  const date = new Date(`${dateString}T12:00:00`);
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

export const getNextDay = (dateString: string): string => {
  return addCalendarDays(dateString, 1);
};

export const getPreviousDay = (dateString: string): string => {
  return addCalendarDays(dateString, -1);
};

const dayShiftStart = (isBusiness: boolean): string =>
  isBusiness ? BUSINESS_DAY_SHIFT_START : NON_BUSINESS_DAY_SHIFT_START;

export const getShiftSchedule = (dateString: string): ShiftSchedule => {
  const todayIsBusinessDay = isBusinessDay(dateString);
  const nextDay = getNextDay(dateString);
  const tomorrowIsBusinessDay = isBusinessDay(nextDay);

  const dayStart = dayShiftStart(todayIsBusinessDay);
  const dayEnd = NIGHT_SHIFT_START;
  const nightStart = NIGHT_SHIFT_START;
  const nightEnd = dayShiftStart(tomorrowIsBusinessDay);

  let description = todayIsBusinessDay ? 'Día Hábil' : 'Fin de Semana / Feriado';
  if (todayIsBusinessDay !== tomorrowIsBusinessDay) {
    description += tomorrowIsBusinessDay ? ' → Día Hábil' : ' → No Hábil';
  }

  return {
    dayStart,
    dayEnd,
    nightStart,
    nightEnd,
    description,
  };
};

export const resolveClinicalDayBounds = (recordDate: string): ClinicalDayBounds => {
  const schedule = getShiftSchedule(recordDate);
  const dayStartMinutes = parseTimeMinutes(schedule.dayStart) ?? BUSINESS_DAY_SHIFT_START_MINUTES;
  const nightEndMinutes = parseTimeMinutes(schedule.nightEnd) ?? BUSINESS_DAY_SHIFT_START_MINUTES;

  return {
    dayStart: schedule.dayStart,
    dayStartMinutes,
    nextDay: getNextDay(recordDate),
    nightEnd: schedule.nightEnd,
    nightEndMinutes,
  };
};
