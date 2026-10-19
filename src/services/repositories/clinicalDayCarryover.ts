import type { DailyRecord } from '@/types/domain/dailyRecord';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { seedClinicalCarryover } from './clinicalCarryoverSeed';

/** Loaded only while constructing a missing day; the ordinary copy already owns a fresh clone. */
export const applyClinicalDayCarryover = (
  destination: DailyRecord,
  source: DailyRecord
): DailyRecord => {
  if (destination.date !== calendarStampInClinicalTimeZone(new Date()).iso) return destination;
  for (const [bedId, patient] of Object.entries(destination.beds)) {
    const previous = source.beds[bedId];
    if (!previous) continue;
    const seeded = seedClinicalCarryover(previous, patient, source.date, destination.date);
    if (previous.clinicalCrib && seeded.clinicalCrib) {
      seeded.clinicalCrib = seedClinicalCarryover(
        previous.clinicalCrib,
        seeded.clinicalCrib,
        source.date,
        destination.date
      );
    }
    destination.beds[bedId] = seeded;
  }
  return destination;
};
