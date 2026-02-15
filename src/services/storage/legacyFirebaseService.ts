/**
 * Legacy Firebase public facade.
 *
 * Keeps existing imports stable while delegating implementation
 * to focused modules.
 */

export {
  initLegacyFirebase,
  getLegacyDb,
  isLegacyAvailable,
} from './legacyfirebase/legacyFirebaseCore';

export {
  getLegacyRecord,
  getLegacyRecordsRange,
  subscribeLegacyRecord,
  discoverLegacyDataPath,
} from './legacyfirebase/legacyFirebaseRecordService';

export {
  getLegacyNurseCatalog,
  getLegacyTensCatalog,
} from './legacyfirebase/legacyFirebaseCatalogService';
