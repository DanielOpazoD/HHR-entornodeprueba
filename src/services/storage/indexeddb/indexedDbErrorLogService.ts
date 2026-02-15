import { ErrorLog } from '@/services/utils/errorService';

import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const saveErrorLog = async (log: ErrorLog): Promise<void> => {
  try {
    await ensureDbReady();
    await db.errorLogs.add(log);
  } catch (error) {
    console.warn('Failed to save error log to IndexedDB:', error);
  }
};

export const getErrorLogs = async (limit = 50): Promise<ErrorLog[]> => {
  try {
    await ensureDbReady();
    return await db.errorLogs.orderBy('timestamp').reverse().limit(limit).toArray();
  } catch (error) {
    console.error('Failed to retrieve error logs:', error);
    return [];
  }
};

export const clearErrorLogs = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.errorLogs.clear();
  } catch (error) {
    console.warn('Failed to clear error logs:', error);
  }
};
