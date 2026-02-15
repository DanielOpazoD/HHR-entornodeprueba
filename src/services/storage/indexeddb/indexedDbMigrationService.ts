import { DailyRecord } from '@/types';
import { AuditLogEntry } from '@/types/audit';
import { safeJsonParse } from '@/utils/jsonUtils';

import { ensureDbReady, hospitalDB as db, registerDatabaseRecreatedHandler } from './indexedDbCore';
import { saveCatalog } from './indexedDbCatalogService';

const STORAGE_KEY = 'hanga_roa_hospital_data';
const NURSES_KEY = 'hanga_roa_nurses_list';
const TENS_KEY = 'hanga_roa_tens_list';
const AUDIT_KEY = 'hanga_roa_audit_logs';
const DEMO_KEY = 'hhr_demo_records';
const MIGRATION_FLAG = 'indexeddb_migration_complete';

const canUseLocalStorage = () => typeof window !== 'undefined' && !!window.localStorage;

export const migrateFromLocalStorage = async (): Promise<boolean> => {
  if (!canUseLocalStorage()) {
    return false;
  }

  if (localStorage.getItem(MIGRATION_FLAG) === 'true') {
    return false;
  }

  try {
    await ensureDbReady();

    const recordsData = localStorage.getItem(STORAGE_KEY);
    if (recordsData) {
      const records = safeJsonParse<Record<string, DailyRecord>>(recordsData, {});
      const recordArray = Object.values(records);
      if (recordArray.length > 0) {
        await db.dailyRecords.bulkPut(recordArray);
      }
    }

    const nursesData = localStorage.getItem(NURSES_KEY);
    if (nursesData) {
      const nurses = safeJsonParse<string[]>(nursesData, []);
      await saveCatalog('nurses', nurses);
    }

    const tensData = localStorage.getItem(TENS_KEY);
    if (tensData) {
      const tens = safeJsonParse<string[]>(tensData, []);
      await saveCatalog('tens', tens);
    }

    const auditData = localStorage.getItem(AUDIT_KEY);
    if (auditData) {
      const logs = safeJsonParse<AuditLogEntry[]>(auditData, []);
      if (logs.length > 0) {
        await db.auditLogs.bulkPut(logs);
      }
    }

    const demoData = localStorage.getItem(DEMO_KEY);
    if (demoData) {
      const records = safeJsonParse<Record<string, DailyRecord>>(demoData, {});
      const recordArray = Object.values(records);
      if (recordArray.length > 0) {
        await db.demoRecords.bulkPut(recordArray);
      }
    }

    localStorage.setItem(MIGRATION_FLAG, 'true');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return false;
  }
};

registerDatabaseRecreatedHandler(() => {
  if (!canUseLocalStorage()) return;
  localStorage.removeItem(MIGRATION_FLAG);
  void migrateFromLocalStorage();
});
