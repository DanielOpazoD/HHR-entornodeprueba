import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import {
  ensureDbReady,
  hospitalDB as db,
  isDatabaseInFallbackMode,
} from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';

/**
 * Test-only IndexedDB reset helpers. Production code must never expose
 * unconditional wipe functions for local daily records or audit logs (SAVE-03).
 */
export const clearAllRecordsForTests = async (): Promise<void> => {
  await ensureDbReady();
  if (isDatabaseInFallbackMode()) {
    localPersistence.records.clear();
    dispatchDailyRecordStoreChanged({ operation: 'clear' });
    return;
  }
  await db.dailyRecords.clear();
  dispatchDailyRecordStoreChanged({ operation: 'clear' });
};

export const clearAuditLogsForTests = async (): Promise<void> => {
  await ensureDbReady();
  await db.auditLogs.clear();
};
