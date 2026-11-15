import { absoluteInstantInRapaNui } from './encounterWallClock';
import { buildSortableLocalTimestamp, parseStrictIsoInstant } from './localTimestamp';

export const flag = (value: unknown): boolean => {
  if (value === true || value === 1) return true;
  const normalized =
    value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 's' ||
    normalized === 'si' ||
    normalized === 'sí'
  );
};

const parsedMs = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const WALL_STAMP =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[T ](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?)?$/;

/** An ISO time on the hospital wall clock, read from its parts (never the device clock), or null. */
const hospitalWallMs = (value: string): number | null => {
  const instant = parseStrictIsoInstant(value);
  const parts = WALL_STAMP.exec((instant ? absoluteInstantInRapaNui(value) : value) ?? '')?.groups;
  if (!parts) return null;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second ?? 0);
  if (!buildSortableLocalTimestamp(year, month, day, hour, minute, second)) return null;
  const ms = instant
    ? instant.getUTCMilliseconds()
    : Number((parts.fraction ?? '').padEnd(3, '0').slice(0, 3));
  return Date.UTC(year, month - 1, day, hour, minute, second, ms);
};

/** The instant at which the hospital wall clock read `wallMs` (its parts as UTC milliseconds). */
const instantOfHospitalWall = (wallMs: number): number => {
  const offsetAt = (instantMs: number) =>
    (hospitalWallMs(new Date(instantMs).toISOString()) ?? instantMs) - instantMs;
  return wallMs - offsetAt(wallMs - offsetAt(wallMs));
};

// A sort asks for the same stamps many times. An ISO key never depends on the device, so it is
// kept; the Date.parse value of other text is read each time.
const isoStampKeys = new Map<string, number | null>();
const isoStampKey = (value: string): number | null => {
  let key = isoStampKeys.get(value);
  if (key === undefined) {
    const instant = parseStrictIsoInstant(value);
    const wall = instant ? null : hospitalWallMs(value);
    key = instant ? instant.getTime() : wall === null ? null : instantOfHospitalWall(wall);
    if (isoStampKeys.size >= 5000) isoStampKeys.clear();
    isoStampKeys.set(value, key);
  }
  return key;
};

/**
 * One number per Eloísa stamp, the same on every device (TIME-02): an instant (`Z` or an offset)
 * is itself; a time without an offset is read on the hospital wall clock (in the repeated hour of a
 * clock change, its first occurrence; in the hour that does not exist, the instant an hour earlier,
 * which a correct Rapa Nui clock never writes). One key per stamp keeps the order total, so mixing formats
 * can never form a cycle. Text that is not an ISO time keeps its Date.parse value (screen forms,
 * a date alone).
 */
const stampKey = (value: string): number => isoStampKey(value) ?? parsedMs(value);

/** Order of two Eloísa stamps, by their keys. */
export const compareStamps = (a: string, b: string): number => stampKey(a) - stampKey(b);

/** Whether a stamp can be ordered at all. */
export const isUsableStamp = (value: string): boolean => stampKey(value) > 0;

/**
 * Hospital calendar day (`YYYY-MM-DD`) of an Eloísa date, or `''` when it is not a date (TIME-02).
 * An ISO instant with `Z` or an offset is read on the Rapa Nui clock. A date alone or a time
 * without an offset keeps the date Eloísa wrote, the date the panel shows next to it.
 */
export const dayKey = (value: string): string => {
  const instant = absoluteInstantInRapaNui(value);
  if (instant) return instant.slice(0, 10);
  // clinical-clock-allow raw-offset-clock: Offset instants returned above; a date alone or a zone-less time keeps the date Eloísa wrote, as the panel shows it.
  const written = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (written) return written[1];
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  // clinical-clock-allow device-calendar-today: Date.parse reads other zone-less text on the device clock and it is read back on that clock, so it keeps the day written on every device.
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};
