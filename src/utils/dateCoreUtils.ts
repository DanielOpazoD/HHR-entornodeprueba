import { isCalendarDate, normalizeCalendarDate } from './clinicalDateUtils';
import { getClinicalCalendarDateISO } from './clinicalTimeZone';

/**
 * Hospital calendar date (`YYYY-MM-DD`). Always resolved in the Rapa Nui time zone, never from
 * the device clock, so a mainland browser cannot advance "today" ahead of the ward.
 */
export const getTodayISO = (now: Date = new Date()): string => getClinicalCalendarDateISO(now);

/**
 * Returns true when `dateString` represents a valid calendar day strictly after the hospital's
 * current calendar date (Rapa Nui wall clock). Empty or invalid values return false.
 */
export const isFutureDate = (dateString: string, now: Date = new Date()): boolean => {
  const normalized = normalizeCalendarDate(dateString);
  if (!normalized || !isCalendarDate(normalized)) {
    return false;
  }

  return normalized > getTodayISO(now);
};
