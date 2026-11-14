import { absoluteInstantInRapaNui } from './encounterWallClock';

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

export const timeKey = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

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
