import { DailyRecord } from '@/types/domain/dailyRecord';
import { safeJsonParse } from '@/utils/jsonUtils';

export const STORAGE_KEY = 'hanga_roa_hospital_data';

export const hasBrowserLocalStorage = (): boolean =>
  typeof window !== 'undefined' && !!window.localStorage;

export const readLocalStorageJson = <T>(key: string, fallback: T): T => {
  try {
    if (!hasBrowserLocalStorage()) return fallback;
    const data = window.localStorage.getItem(key);
    return data ? safeJsonParse<T>(data, fallback) : fallback;
  } catch {
    return fallback;
  }
};

export const writeLocalStorageJson = <T>(key: string, value: T): void => {
  if (!hasBrowserLocalStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

export const getClosestPreviousRecord = (
  records: Record<string, DailyRecord>,
  currentDate: string
): DailyRecord | null => {
  const dates = Object.keys(records).sort();
  let closestDate: string | null = null;

  for (const date of dates) {
    if (date < currentDate) {
      closestDate = date;
    } else {
      break;
    }
  }

  return closestDate ? records[closestDate] : null;
};
