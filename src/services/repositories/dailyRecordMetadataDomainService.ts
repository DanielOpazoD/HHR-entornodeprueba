import type { DailyRecordMetadataState } from '@/types/domain/dailyRecordSlices';

export const createRecordDateTimestamp = (date: string): number =>
  new Date(`${date}T00:00:00`).getTime();

export const ensureDailyRecordDateTimestamp = (record: DailyRecordMetadataState): void => {
  if (!record.date) {
    return;
  }

  const persistedTimestamp = record.dateTimestamp;
  if (typeof persistedTimestamp === 'number' && Number.isInteger(persistedTimestamp)) {
    const persistedDate = new Date(persistedTimestamp);
    if (
      Number.isFinite(persistedDate.getTime()) &&
      persistedDate.toISOString().slice(0, 10) === record.date
    ) {
      return;
    }
  }

  const canonicalTimestamp = createRecordDateTimestamp(record.date);
  if (record.dateTimestamp !== canonicalTimestamp) {
    record.dateTimestamp = canonicalTimestamp;
  }
};

export const touchDailyRecordLastUpdated = (record: DailyRecordMetadataState): void => {
  record.lastUpdated = new Date().toISOString();
};
