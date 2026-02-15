import { DailyRecord } from '@/types';

import {
  clearAllDemoRecords,
  deleteDemoRecord as deleteDemoRecordIndexedDb,
  saveDemoRecord as saveDemoRecordIndexedDb,
} from '../indexedDBService';
import {
  DEMO_STORAGE_KEY,
  getClosestPreviousRecord,
  readLocalStorageJson,
  writeLocalStorageJson,
} from './localStorageCore';

export const getDemoRecords = (): Record<string, DailyRecord> =>
  readLocalStorageJson<Record<string, DailyRecord>>(DEMO_STORAGE_KEY, {});

export const saveDemoRecord = (record: DailyRecord): void => {
  saveDemoRecordIndexedDb(record);

  const allRecords = getDemoRecords();
  allRecords[record.date] = record;
  writeLocalStorageJson(DEMO_STORAGE_KEY, allRecords);
};

export const saveDemoRecords = (records: DailyRecord[]): void => {
  records.forEach(record => {
    saveDemoRecordIndexedDb(record);
  });

  const allRecords = getDemoRecords();
  records.forEach(record => {
    allRecords[record.date] = record;
  });
  writeLocalStorageJson(DEMO_STORAGE_KEY, allRecords);
};

export const getDemoRecordForDate = (date: string): DailyRecord | null => {
  const records = getDemoRecords();
  return records[date] || null;
};

export const getAllDemoDates = (): string[] => Object.keys(getDemoRecords()).sort().reverse();

export const deleteDemoRecord = (date: string): void => {
  deleteDemoRecordIndexedDb(date);
  const allRecords = getDemoRecords();
  delete allRecords[date];
  writeLocalStorageJson(DEMO_STORAGE_KEY, allRecords);
};

export const clearAllDemoData = (): void => {
  clearAllDemoRecords();
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
  }
};

export const getPreviousDemoDayRecord = (currentDate: string): DailyRecord | null =>
  getClosestPreviousRecord(getDemoRecords(), currentDate);
