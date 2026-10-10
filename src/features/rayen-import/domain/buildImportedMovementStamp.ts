import type { DischargeEntry } from '../contracts/censusImportDiff';
import { calendarDateForMovement } from '@/utils/movementCalendarDate';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

/** Altas and transfers share one date/time contract, independent of their owning census record. */
export const buildImportedMovementStamp = (
  entry: DischargeEntry,
  censusDate: string,
  now: Date,
  source: 'manual' | 'gestion_camas'
) => {
  const time = entry.correctedTime || calendarStampInClinicalTimeZone(now).hhmm;
  return {
    time,
    movementDate:
      source === 'gestion_camas'
        ? calendarDateForMovement(entry.correctedDay || censusDate, time)
        : censusDate,
  };
};
