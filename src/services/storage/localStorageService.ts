/**
 * localStorage public facade.
 *
 * Keeps existing imports stable while delegating implementation
 * to focused localstorage modules.
 */

export { STORAGE_KEY, NURSES_STORAGE_KEY } from './localstorage/localStorageCore';

export {
  getStoredRecords,
  saveRecordLocal,
  getRecordForDate,
  getAllDates,
  getPreviousDayRecord,
  deleteRecordLocal,
} from './localstorage/localStorageRecordService';

export { getStoredNurses, saveStoredNurses } from './localstorage/localStorageNurseService';

export {
  clearAllData,
  isLocalStorageAvailable,
} from './localstorage/localStorageMaintenanceService';

export {
  getDemoRecords,
  saveDemoRecord,
  saveDemoRecords,
  getDemoRecordForDate,
  getAllDemoDates,
  deleteDemoRecord,
  clearAllDemoData,
  getPreviousDemoDayRecord,
} from './localstorage/localStorageDemoService';
