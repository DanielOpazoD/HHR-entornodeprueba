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

module.exports = { hospitalCalendarDay, hospitalDayStart };
