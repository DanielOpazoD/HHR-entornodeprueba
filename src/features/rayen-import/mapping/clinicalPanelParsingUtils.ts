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

const WALL_STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/** An ISO time on the hospital wall clock, read from its parts (never the device clock), or null. */
const hospitalWallMs = (value: string): number | null => {
  const instant = parseStrictIsoInstant(value);
  const parts = WALL_STAMP.exec((instant ? absoluteInstantInRapaNui(value) : value) ?? '');
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(part => Number(part ?? 0));
  if (!buildSortableLocalTimestamp(year, month, day, hour, minute, second)) return null;
  const ms = instant
    ? instant.getUTCMilliseconds()
    : Number((parts[7] ?? '').padEnd(3, '0').slice(0, 3));
  return Date.UTC(year, month - 1, day, hour, minute, second, ms);
};

/**
 * Order of two Eloísa stamps, the same on every device (TIME-02): two instants (`Z` or an offset)
 * by their instants; otherwise each ISO time on the hospital wall clock, an instant converted to
 * Rapa Nui and a time without an offset as written.
 */
export const compareStamps = (a: string, b: string): number => {
  const instantA = parseStrictIsoInstant(a);
  const instantB = parseStrictIsoInstant(b);
  if (instantA && instantB) return instantA.getTime() - instantB.getTime();
  const wallA = hospitalWallMs(a);
  const wallB = hospitalWallMs(b);
  if (wallA !== null && wallB !== null) return wallA - wallB;
  // Text that is not an ISO time (screen forms, garbage, a date alone) keeps its Date.parse order.
  return parsedMs(a) - parsedMs(b);
};

/** Whether a stamp can be ordered at all. */
export const isUsableStamp = (value: string): boolean =>
  (hospitalWallMs(value) ?? parsedMs(value)) > 0;

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
  // Date.parse reads other zone-less text on the device clock and it is read back on that clock,
  // so such a text gets the same day on every device.
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};
