const hospitalDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Easter',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hospitalCalendarDay = (instant = new Date()) => {
  const parts = hospitalDayFormatter
    .formatToParts(instant)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

// Rapa Nui midnight falls at 05:00 UTC in summer time and at 06:00 UTC in winter time.
const HOSPITAL_MIDNIGHT_UTC_HOURS = [5, 6];

/** The instant a hospital calendar day (YYYY-MM-DD) starts, or NaN for a malformed day. */
const hospitalDayStart = day => {
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(utcMidnight)) return NaN;
  return (
    HOSPITAL_MIDNIGHT_UTC_HOURS.map(hours => utcMidnight + hours * 3_600_000).find(
      instant => hospitalCalendarDay(new Date(instant)) === day
    ) ?? NaN
  );
};

/**
 * The one UTC-noon anchor of a YYYY-MM-DD day on the server: read it only with UTC getters, so
 * its date, weekday and month are that day's whatever the zone.
 */
const calendarDayAtUtcNoon = day => new Date(`${day}T12:00:00Z`);

/** A real YYYY-MM-DD calendar day: 2026-02-30 and 2026-1-5 are not. */
const isCalendarDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = calendarDayAtUtcNoon(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** The calendar day `days` after (or before) `day`. */
const addCalendarDays = (day, days) => {
  const date = calendarDayAtUtcNoon(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

module.exports = {
  addCalendarDays,
  calendarDayAtUtcNoon,
  hospitalCalendarDay,
  hospitalDayStart,
  isCalendarDay,
};
