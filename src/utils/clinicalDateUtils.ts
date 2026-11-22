export const normalizeDateOnly = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.split('T')[0];
};

export const normalizeCalendarDate = (value?: string): string | undefined => {
  if (!value) return undefined;

  const datePart = (value.split('T')[0] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(datePart)) {
    const [day, month, year] = datePart.split('-');
    return `${year}-${month}-${day}`;
  }

  return undefined;
};

export const parseCalendarDateUtcNoon = (value?: string): number | null => {
  const normalized = normalizeCalendarDate(value);
  if (!normalized) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    [year, month, day].some(part => Number.isNaN(part))
  ) {
    return null;
  }

  // Date.UTC reads years 0–99 as 1900–1999; setUTCFullYear takes them as written.
  const anchor = new Date(0);
  anchor.setUTCFullYear(year, month - 1, day);
  anchor.setUTCHours(12, 0, 0, 0);
  return anchor.getTime();
};

/**
 * The one UTC-noon anchor of a `YYYY-MM-DD` calendar day. Read it only with UTC getters or
 * `timeZone: 'UTC'`: its UTC date, weekday and month are that day's on any device, ahead of UTC
 * by more than twelve hours or behind it. Pacific/Easter changes of hour never move it.
 */
export const calendarDayAtUtcNoon = (dateString: string): Date =>
  new Date(`${dateString}T12:00:00Z`);

/** A real `YYYY-MM-DD` calendar day: 2026-02-30 and 2026-1-5 are not. */
export const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = calendarDayAtUtcNoon(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/**
 * The day a census address opens on: its `?date=` when that is a real calendar day with a
 * four-digit year, otherwise `clinicalDay` (the hospital's current clinical day). The header
 * painted before sign-in and the census after it both start here, so they never disagree.
 */
export const resolveLandingCalendarDay = (search: string, clinicalDay: string): string => {
  const requested = new URLSearchParams(search).get('date');
  return requested && requested >= '1000' && isCalendarDate(requested) ? requested : clinicalDay;
};

export const addCalendarDays = (dateString: string, days: number): string => {
  // UTC on both sides: the label never passes through the device zone, so a device ahead of
  // UTC by more than twelve hours gets the same day as the hospital.
  const date = calendarDayAtUtcNoon(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  // clinical-clock-allow instant-calendar-slice: date represents the input calendar day shifted from noon; it is not an event instant.
  return date.toISOString().split('T')[0] ?? dateString;
};

export const diffCalendarDays = (startDate?: string, endDate?: string): number | null => {
  const start = parseCalendarDateUtcNoon(startDate);
  const end = parseCalendarDateUtcNoon(endDate);
  if (start === null || end === null) {
    return null;
  }

  return Math.round((end - start) / (1000 * 60 * 60 * 24));
};
