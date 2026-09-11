import { getClinicalCalendarDateISO } from './clinicalTimeZone';

/**
 * Hospital calendar date (`YYYY-MM-DD`). Always resolved in the Rapa Nui time zone, never from
 * the device clock, so a mainland browser cannot advance "today" ahead of the ward.
 */
export const getTodayISO = (now: Date = new Date()): string => getClinicalCalendarDateISO(now);

export const isFutureDate = (dateString: string): boolean => dateString > getTodayISO();

export const parseISODate = (isoDate?: string): Date | null => {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  return isNaN(date.getTime()) ? null : date;
};
