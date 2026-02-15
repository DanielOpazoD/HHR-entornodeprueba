import { DailyRecord } from '@/types';

import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';

const toRecordMap = (records: DailyRecord[]): Record<string, DailyRecord> => {
  const result: Record<string, DailyRecord> = {};
  for (const record of records) {
    result[record.date] = record;
  }
  return result;
};

export const getAllRecords = async (): Promise<Record<string, DailyRecord>> => {
  try {
    await ensureDbReady();
    const records = await db.dailyRecords.toArray();
    return toRecordMap(records);
  } catch (error) {
    console.error('Failed to get all records from IndexedDB:', error);
    return {};
  }
};

export const getRecordsForMonth = async (year: number, month: number): Promise<DailyRecord[]> => {
  try {
    await ensureDbReady();
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return await db.dailyRecords.where('date').startsWith(prefix).toArray();
  } catch (error) {
    console.error(`Failed to get records for month ${year}-${month}:`, error);
    return [];
  }
};

export const getRecordForDate = async (date: string): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();

    if (
      isDatabaseInFallbackMode() &&
      typeof window !== 'undefined' &&
      window.__HHR_E2E_OVERRIDE__
    ) {
      const override = window.__HHR_E2E_OVERRIDE__;
      if (override[date]) return override[date];
    }

    const record = await db.dailyRecords.get(date);
    return record || null;
  } catch (error) {
    console.error(`Failed to get record for ${date}:`, error);
    return null;
  }
};

export const saveRecord = async (record: DailyRecord): Promise<void> => {
  try {
    await ensureDbReady();
    await db.dailyRecords.put(record);
  } catch (error) {
    console.error('Failed to save record to IndexedDB:', error);
  }
};

export const deleteRecord = async (date: string): Promise<void> => {
  try {
    await ensureDbReady();
    await db.dailyRecords.delete(date);
  } catch (error) {
    console.error('Failed to delete record from IndexedDB:', error);
  }
};

export const getAllDates = async (): Promise<string[]> => {
  try {
    await ensureDbReady();
    const records = await db.dailyRecords.orderBy('date').reverse().keys();
    return records as string[];
  } catch (error) {
    console.error('Failed to get all dates from IndexedDB:', error);
    return [];
  }
};

export const getPreviousDayRecord = async (currentDate: string): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();
    const record = await db.dailyRecords.where('date').below(currentDate).reverse().first();
    return record || null;
  } catch (error) {
    console.error('Failed to get previous day record:', error);
    return null;
  }
};

export const clearAllRecords = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.dailyRecords.clear();
  } catch (error) {
    console.error('Failed to clear all records from IndexedDB:', error);
  }
};

export const saveDemoRecord = async (record: DailyRecord): Promise<void> => {
  try {
    await ensureDbReady();
    await db.demoRecords.put(record);
  } catch (error) {
    console.error('[IndexedDB] Failed to save demo record:', error);
  }
};

export const getDemoRecordForDate = async (date: string): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();
    const record = await db.demoRecords.get(date);
    return record || null;
  } catch (error) {
    console.error(`[IndexedDB] Failed to get demo record for ${date}:`, error);
    return null;
  }
};

export const getAllDemoRecords = async (): Promise<Record<string, DailyRecord>> => {
  try {
    await ensureDbReady();
    const records = await db.demoRecords.toArray();
    return toRecordMap(records);
  } catch (error) {
    console.error('[IndexedDB] Failed to get all demo records:', error);
    return {};
  }
};

export const deleteDemoRecord = async (date: string): Promise<void> => {
  try {
    await ensureDbReady();
    await db.demoRecords.delete(date);
  } catch (error) {
    console.error('[IndexedDB] Failed to delete demo record:', error);
  }
};

export const clearAllDemoRecords = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.demoRecords.clear();
  } catch (error) {
    console.error('[IndexedDB] Failed to clear all demo records:', error);
  }
};

export const getPreviousDemoDayRecord = async (
  currentDate: string
): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();
    const record = await db.demoRecords.where('date').below(currentDate).reverse().first();
    return record || null;
  } catch (error) {
    console.error('[IndexedDB] Failed to get previous demo day record:', error);
    return null;
  }
};
