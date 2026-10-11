import type { DailyRecordMetadataState } from '@/types/domain/dailyRecordSlices';

export const createRecordDateTimestamp = (date: string): number =>
  new Date(`${date}T00:00:00`).getTime();

export const ensureDailyRecordDateTimestamp = (record: DailyRecordMetadataState): void => {
  if (
    record.date &&
    (!Number.isInteger(record.dateTimestamp) ||
      new Date(record.dateTimestamp ?? NaN).toJSON()?.slice(0, 10) !== record.date)
  ) {
    record.dateTimestamp = createRecordDateTimestamp(record.date);
  }
};

export const touchDailyRecordLastUpdated = (record: DailyRecordMetadataState): void => {
  record.lastUpdated = new Date().toISOString();
};
