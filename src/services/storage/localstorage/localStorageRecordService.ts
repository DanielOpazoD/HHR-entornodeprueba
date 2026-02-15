import { DailyRecord } from '@/types';

import {
  STORAGE_KEY,
  getClosestPreviousRecord,
  readLocalStorageJson,
  writeLocalStorageJson,
} from './localStorageCore';

export const getStoredRecords = (): Record<string, DailyRecord> =>
  readLocalStorageJson<Record<string, DailyRecord>>(STORAGE_KEY, {});

export const saveRecordLocal = (record: DailyRecord): void => {
  const allRecords = getStoredRecords();
  allRecords[record.date] = record;
  writeLocalStorageJson(STORAGE_KEY, allRecords);
};

export const getRecordForDate = (date: string): DailyRecord | null => {
  const records = getStoredRecords();
  return records[date] || null;
};

export const getAllDates = (): string[] => Object.keys(getStoredRecords()).sort().reverse();

export const getPreviousDayRecord = (currentDate: string): DailyRecord | null =>
  getClosestPreviousRecord(getStoredRecords(), currentDate);

export const deleteRecordLocal = (date: string): void => {
  const allRecords = getStoredRecords();
  delete allRecords[date];
  writeLocalStorageJson(STORAGE_KEY, allRecords);
};
