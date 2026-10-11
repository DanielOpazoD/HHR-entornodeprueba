import type { DailyRecordMetadataState } from '@/types/domain/dailyRecordSlices';

export const createRecordDateTimestamp = (date: string): number => Date.parse(`${date}T00:00:00Z`);

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
