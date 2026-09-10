/**
 * Single source of truth for the hospital wall clock.
 *
 * Hospital Hanga Roa lives in Rapa Nui (`Pacific/Easter`, UTC-6/UTC-5), while most devices that
 * operate HHR are configured for mainland Chile (`America/Santiago`, UTC-4/UTC-3). Any "today"
 * derived from the browser clock can therefore be up to two hours ahead of the hospital, which
 * shifts the calendar day between 00:00 and 02:00 Santiago time and breaks every clinical rule
 * that compares a census date against "today" (shift rollover, admission limits, print dates,
 * synchronization windows). Every such derivation must go through this module.
 */
export const CLINICAL_TIME_ZONE = 'Pacific/Easter';

export interface ClinicalCalendarStamp {
  /** Calendar day in the hospital time zone, `YYYY-MM-DD`. */
  iso: string;
  /** Wall-clock time in the hospital time zone, `HH:mm` (24h). */
  hhmm: string;
}

const clinicalStampFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Calendar day and wall-clock time of `now` as seen from the hospital. */
export const calendarStampInClinicalTimeZone = (now: Date = new Date()): ClinicalCalendarStamp => {
  const parts = clinicalStampFormatter.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';
  return {
    iso: `${value('year')}-${value('month')}-${value('day')}`,
    hhmm: `${value('hour')}:${value('minute')}`,
  };
};

/** Hospital calendar date (`YYYY-MM-DD`) for `now`, independent of the device time zone. */
export const getClinicalCalendarDateISO = (now: Date = new Date()): string =>
  calendarStampInClinicalTimeZone(now).iso;
