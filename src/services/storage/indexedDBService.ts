/**
 * @deprecated Compatibility facade only.
 *
 * New source code should import from the focused modules under
 * `services/storage/indexeddb/*`. This file remains as a controlled bridge and
 * is protected by persistence boundary checks.
 */

export { HangaRoaDatabase, createMockDatabase, hospitalDB } from './indexeddb/indexedDbCore';

export { saveErrorLog, getErrorLogs, clearErrorLogs } from './indexeddb/indexedDbErrorLogService';

export {
  getAllRecords,
  getAllRecordsSorted,
  getRecordsForMonth,
  getRecordsRange,
  getRecordForDate,
  saveRecord,
  saveRecordStrict,
  saveRecords,
  saveRecordsStrict,
  deleteRecord,
  deleteRecordStrict,
  getAllDates,
  getPreviousDayRecord,
  clearAllRecords,
  type LocalRecordWriteResult,
  type LocalRecordWriteStore,
} from './indexeddb/indexedDbRecordService';

export { buildMonthRecordPrefix } from './storageDateSupport';

export {
  saveAuditLog,
  getAuditLogs,
  clearAuditLogs,
  getAuditLogsForDate,
} from './indexeddb/indexedDbAuditLogService';

export {
  getCatalog,
  saveCatalog,
  clearCatalog,
  getCatalogValues,
  saveCatalogValues,
} from './indexeddb/indexedDbCatalogService';

export { migrateFromLocalStorage } from './indexeddb/indexedDbMigrationService';

export { saveSetting, getSetting, clearAllSettings } from './indexeddb/indexedDbSettingsService';

export { isIndexedDBAvailable, isDatabaseInFallbackMode } from './indexeddb/indexedDbCore';

export {
  resetLocalDatabase,
  performClientHardReset,
  resetLocalAppStorage,
} from './indexeddb/indexedDbMaintenanceService';
