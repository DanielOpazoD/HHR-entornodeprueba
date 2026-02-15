import { AuditLogEntry } from '@/types/audit';

import { ensureDbReady, hospitalDB as db } from './indexedDbCore';

export const saveAuditLog = async (log: AuditLogEntry): Promise<void> => {
  try {
    await ensureDbReady();
    await db.auditLogs.put(log);
  } catch (error) {
    console.warn('Failed to save audit log to IndexedDB:', error);
  }
};

export const getAuditLogs = async (limitCount = 100): Promise<AuditLogEntry[]> => {
  try {
    await ensureDbReady();
    return await db.auditLogs.orderBy('timestamp').reverse().limit(limitCount).toArray();
  } catch (error) {
    console.error('Failed to retrieve audit logs from IndexedDB:', error);
    return [];
  }
};

export const clearAuditLogs = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await db.auditLogs.clear();
  } catch (error) {
    console.error('Failed to clear audit logs from IndexedDB:', error);
  }
};

export const getAuditLogsForDate = async (date: string): Promise<AuditLogEntry[]> => {
  try {
    await ensureDbReady();
    return await db.auditLogs.where('recordDate').equals(date).toArray();
  } catch (error) {
    console.error(`Failed to get audit logs for date ${date}:`, error);
    return [];
  }
};
