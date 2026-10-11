import type { DailyRecordMetadataState } from '@/types/domain/dailyRecordSlices';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

/** New records use hospital midnight; the device time zone never defines the editing window. */
export const createRecordDateTimestamp = (date: string): number => {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toJSON()?.slice(0, 10) !== date) return NaN;
  let instant = midnight;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { iso, hhmm } = calendarStampInClinicalTimeZone(new Date(instant));
    const delta = midnight - Date.parse(`${iso}T${hhmm}:00Z`);
    if (delta === 0) return instant;
    instant += delta;
  }
  return NaN;
};

export const ensureDailyRecordDateTimestamp = (record: DailyRecordMetadataState): void => {
  const { date, dateTimestamp } = record;
  if (
    date &&
    (!Number.isInteger(dateTimestamp) || new Date(dateTimestamp!).toJSON()?.slice(0, 10) !== date)
  ) {
    record.dateTimestamp = createRecordDateTimestamp(date);
  }
};

export const touchDailyRecordLastUpdated = (record: DailyRecordMetadataState): void => {
  record.lastUpdated = new Date().toISOString();
};
