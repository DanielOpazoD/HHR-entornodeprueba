import {
  CLINICAL_TIME_ZONE,
  calendarStampInClinicalTimeZone,
  type ClinicalCalendarStamp,
} from './clinicalTimeZone';

export const formatDateDDMMYYYY = (isoDate?: string): string => {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};

const CALENDAR_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Formats a `YYYY-MM-DD` calendar day with `Intl` options. The day is pinned to UTC noon and
 * rendered in UTC, so the label is the same on every device whatever its zone. Returns `null`
 * when the value is not a calendar date, so each caller keeps its own fallback.
 */
export const formatCalendarDate = (
  isoDate: string,
  options: Intl.DateTimeFormatOptions = {},
  locale = 'es-CL'
): string | null => {
  const match = CALENDAR_DATE.exec(isoDate);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(locale, {
    ...options,
    timeZone: 'UTC',
  });
};

const LONG_DATE_OPTIONS = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
} as const;

/**
 * Long Spanish date (`miércoles, 25 de diciembre de 2024`). A `YYYY-MM-DD` string is a
 * calendar day; a `Date` is an instant, read on the hospital clock.
 */
export const formatDateForDisplay = (value: Date | string): string =>
  typeof value === 'string'
    ? (formatCalendarDate(value, LONG_DATE_OPTIONS) ?? value)
    : value.toLocaleDateString('es-CL', { ...LONG_DATE_OPTIONS, timeZone: CLINICAL_TIME_ZONE });

const ZONE_LESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Reads a timestamp string the way the hospital does, whatever the device zone. An ISO
 * instant (`Z` or an offset) is read on the hospital clock. A zone-less
 * `YYYY-MM-DDTHH:mm[:ss]` (Rayen, `datetime-local` inputs) is already a hospital wall-clock
 * reading, so it is kept as written: it is anchored in UTC and must be shown in UTC.
 */
const readTimestamp = (value: string): { date: Date; timeZone: string } | null => {
  const isWallClock = ZONE_LESS_DATE_TIME.test(value);
  const date = new Date(isWallClock ? `${value.replace(' ', 'T')}Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return { date, timeZone: isWallClock ? 'UTC' : CLINICAL_TIME_ZONE };
};

/** Formats a timestamp string with `Intl` options on the hospital clock; `null` if not a date. */
export const formatTimestamp = (
  value: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'es-CL'
): string | null => {
  const timestamp = readTimestamp(value);
  return timestamp
    ? timestamp.date.toLocaleString(locale, { ...options, timeZone: timestamp.timeZone })
    : null;
};

/**
 * Hospital calendar day (`YYYY-MM-DD`) and wall-clock time (`HH:mm`) of a timestamp string,
 * for hand-built labels; `null` if not a date.
 */
export const readClinicalTimestamp = (value: string): ClinicalCalendarStamp | null => {
  const timestamp = readTimestamp(value);
  if (!timestamp) return null;
  if (timestamp.timeZone === CLINICAL_TIME_ZONE) {
    return calendarStampInClinicalTimeZone(timestamp.date);
  }
  const wallClock = timestamp.date.toISOString();
  // clinical-clock-allow instant-calendar-slice: readTimestamp already classified this value as unzoned hospital wall time, encoded in UTC.
  return { iso: wallClock.slice(0, 10), hhmm: wallClock.slice(11, 16) };
};

/** `HH:mm` (24h) of a timestamp on the hospital clock. */
export const formatTimeHHMM = (isoDateTime?: string): string => {
  if (!isoDateTime) return '--:--';

  return (
    formatTimestamp(isoDateTime, { hour: '2-digit', minute: '2-digit', hour12: false }) ?? '--:--'
  );
};

/**
 * Formats a timestamp as a short es-CL date + 24-hour time on the hospital clock
 * (e.g. `25-06-2026, 16:30`). The clock is pinned to 24h (`hour12: false`) so the
 * output is deterministic across runtimes instead of varying with the host ICU's
 * locale default. Returns the original input unchanged when it is not a parseable
 * date, matching the prescriptions/wound-care display contract.
 */
export const formatDateTimeCL = (isoDateTime: string): string =>
  formatTimestamp(isoDateTime, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) ?? isoDateTime;
