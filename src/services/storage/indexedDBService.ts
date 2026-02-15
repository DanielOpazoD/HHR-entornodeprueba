/**
 * IndexedDB public facade.
 *
 * Keeps legacy imports stable while delegating responsibilities
 * to focused internal modules.
 */

export { HangaRoaDatabase, createMockDatabase, hospitalDB } from './indexeddb/indexedDbCore';

export { saveErrorLog, getErrorLogs, clearErrorLogs } from './indexeddb/indexedDbErrorLogService';

export {
  getAllRecords,
  getRecordsForMonth,
  getRecordForDate,
  saveRecord,
  deleteRecord,
  getAllDates,
  getPreviousDayRecord,
  clearAllRecords,
  saveDemoRecord,
  getDemoRecordForDate,
  getAllDemoRecords,
  deleteDemoRecord,
  clearAllDemoRecords,
  getPreviousDemoDayRecord,
} from './indexeddb/indexedDbRecordService';

export {
  saveAuditLog,
  getAuditLogs,
  clearAuditLogs,
  getAuditLogsForDate,
} from './indexeddb/indexedDbAuditLogService';

export { getCatalog, saveCatalog, clearCatalog } from './indexeddb/indexedDbCatalogService';

export { migrateFromLocalStorage } from './indexeddb/indexedDbMigrationService';

export { saveSetting, getSetting, clearAllSettings } from './indexeddb/indexedDbSettingsService';

export { isIndexedDBAvailable, isDatabaseInFallbackMode } from './indexeddb/indexedDbCore';

export { resetLocalDatabase } from './indexeddb/indexedDbMaintenanceService';
