/**
 * Table Configuration Service
 * Manages table column widths with Firebase sync and export/import
 */

import { doc } from 'firebase/firestore';
import { SETTINGS_DOCS, getSettingsDocPath } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  readFirestoreDocument,
  saveFirestoreDocument,
  subscribeToFirestoreDocument,
} from '@/services/storage/firestore/firestoreDocumentStore';
import { tableConfigLogger } from '@/services/storage/storageLoggers';
import {
  CURRENT_TABLE_CONFIG_VERSION,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_PAGE_MARGIN,
  TABLE_CONFIG_LOCAL_CACHE_KEY,
  getDefaultConfig,
  getInitialTableConfig,
  migrateTableConfig,
  type TableColumnConfig,
  type TableConfig,
} from './tableConfigDefaults';

export {
  CURRENT_TABLE_CONFIG_VERSION,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_PAGE_MARGIN,
  TABLE_CONFIG_LOCAL_CACHE_KEY,
  getDefaultConfig,
  getInitialTableConfig,
  migrateTableConfig,
  type TableColumnConfig,
  type TableConfig,
};

// ============================================================================
// Configuration
// ============================================================================

let firestoreEnabled = true;

export const setFirestoreEnabled = (enabled: boolean): void => {
  firestoreEnabled = enabled;
};

export const cacheTableConfigLocally = (config: TableConfig): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(TABLE_CONFIG_LOCAL_CACHE_KEY, JSON.stringify(config));
  } catch (error) {
    tableConfigLogger.warn('Failed to cache table config locally', error);
  }
};

// ============================================================================
// Firebase Operations
// ============================================================================

const getDocRef = (runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime) =>
  doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.TABLE_CONFIG));

const mergeWithDefaultConfig = (config: Partial<TableConfig>): TableConfig =>
  migrateTableConfig(config);

export const createTableConfigService = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => ({
  async load(): Promise<TableConfig> {
    if (!firestoreEnabled) return getDefaultConfig();
    try {
      const config = await readFirestoreDocument(runtime, getDocRef);
      if (config) {
        const mergedConfig = mergeWithDefaultConfig(config as Partial<TableConfig>);
        cacheTableConfigLocally(mergedConfig);
        return mergedConfig;
      }
      const defaultConfig = getDefaultConfig();
      cacheTableConfigLocally(defaultConfig);
      return defaultConfig;
    } catch (_error) {
      tableConfigLogger.error('Error loading table config', _error);
      return getDefaultConfig();
    }
  },
  async save(config: TableConfig): Promise<void> {
    if (!firestoreEnabled) return;
    try {
      await saveFirestoreDocument(runtime, getDocRef, {
        ...config,
        lastUpdated: new Date().toISOString(),
      });
      cacheTableConfigLocally(config);
    } catch (_error) {
      tableConfigLogger.error('Error saving table config', _error);
      throw _error;
    }
  },
  subscribe(callback: (config: TableConfig) => void): () => void {
    if (!firestoreEnabled) {
      callback(getDefaultConfig());
      return () => {};
    }
    return subscribeToFirestoreDocument({
      runtime,
      resolveRef: getDocRef,
      onData: config => {
        const mergedConfig = config
          ? mergeWithDefaultConfig(config as Partial<TableConfig>)
          : getDefaultConfig();
        cacheTableConfigLocally(mergedConfig);
        callback(mergedConfig);
      },
      onError: error => {
        tableConfigLogger.error('Error preparing table config subscription', error);
        callback(getDefaultConfig());
      },
    });
  },
});

const defaultTableConfigService = createTableConfigService();

/**
 * Load table configuration from Firestore
 */
export const loadTableConfig = async (): Promise<TableConfig> => defaultTableConfigService.load();

/**
 * Save table configuration to Firestore
 */
export const saveTableConfig = async (config: TableConfig): Promise<void> =>
  defaultTableConfigService.save(config);

/**
 * Subscribe to table configuration changes
 */
export const subscribeToTableConfig = (callback: (config: TableConfig) => void): (() => void) =>
  defaultTableConfigService.subscribe(callback);
