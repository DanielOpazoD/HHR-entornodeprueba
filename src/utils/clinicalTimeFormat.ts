/**
 * Hospital-clock formatting and day arithmetic for screens and reports (DD-MM-YYYY, HH:mm).
 * Kept apart from `clinicalTimeZone.ts`, which is also bundled into the server CUDYR parser.
 */
import { CLINICAL_TIME_ZONE, getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

const clinicalSecondsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Hospital wall clock of an instant, read back as if it were UTC (offset arithmetic). */
const clinicalWallClockAsUtc = (epochMs: number): number => {
  const parts = clinicalSecondsFormatter.formatToParts(new Date(epochMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  return Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second')
  );
};

/** Instant at which the hospital calendar day `YYYY-MM-DD` starts (00:00 in Rapa Nui). */
export const clinicalDayStartEpochMs = (dateIso: string): number => {
  const [year, month, day] = dateIso.split('-').map(Number);
  const wallMidnight = Date.UTC(year, month - 1, day);
  const firstGuess = wallMidnight - (clinicalWallClockAsUtc(wallMidnight) - wallMidnight);
  return wallMidnight - (clinicalWallClockAsUtc(firstGuess) - firstGuess);
};

/** Shifts a hospital calendar date by whole days. */
export const addClinicalDays = (dateIso: string, days: number): string => {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** `DD-MM-YYYY` of an instant or of a `YYYY-MM-DD` hospital date. */
export const formatClinicalDayMonthYear = (value: number | string): string => {
  const iso = typeof value === 'number' ? getClinicalCalendarDateISO(new Date(value)) : value;
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}-${month}-${year}` : iso;
};

/** `HH:mm` (or `HH:mm:ss`) of an instant on the hospital clock. */
export const formatClinicalClock = (epochMs: number, withSeconds = false): string => {
  const parts = clinicalSecondsFormatter.formatToParts(new Date(epochMs));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '00';
  const clock = `${value('hour')}:${value('minute')}`;
  return withSeconds ? `${clock}:${value('second')}` : clock;
};
