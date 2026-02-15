import { safeJsonParse } from '@/utils/jsonUtils';

import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';

export const saveSetting = async (id: string, value: unknown): Promise<void> => {
  try {
    await ensureDbReady();
    await db.settings.put({ id, value });
  } catch (error) {
    console.error(`[IndexedDB] Failed to save setting ${id}:`, error);
  }
};

export const getSetting = async <T>(id: string, defaultValue: T): Promise<T> => {
  try {
    await ensureDbReady();

    if (isDatabaseInFallbackMode()) {
      if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
      const val = localStorage.getItem(id);
      if (val) {
        return safeJsonParse<T>(val, val as T);
      }
      return defaultValue;
    }

    const item = await db.settings.get(id);
    return item ? (item.value as T) : defaultValue;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      (error as { name?: string }).name !== 'DatabaseClosedError'
    ) {
      console.error(`[IndexedDB] Failed to get setting ${id}:`, error);
    }
    return defaultValue;
  }
};

export const clearAllSettings = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.settings.clear();
  } catch (error) {
    console.error('[IndexedDB] Failed to clear all settings:', error);
  }
};
