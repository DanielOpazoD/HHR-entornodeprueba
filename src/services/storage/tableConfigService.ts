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
import { safeJsonParse } from '@/utils/jsonUtils';
import { tableConfigLogger } from '@/services/storage/storageLoggers';

// ============================================================================
// Types
// ============================================================================

export interface TableColumnConfig {
  actions: number; // Column for action buttons (demo, menu)
  bed: number;
  type: number;
  name: number;
  rut: number;
  age: number;
  diagnosis: number;
  specialty: number;
  status: number;
  admission: number;
  dmi: number;
  scores: number;
  cqx: number;
  upc: number;
}

export interface TableConfig {
  columns: TableColumnConfig;
  pageMargin: number; // margin in pixels for the page container
  lastUpdated: string;
  version: number;
}

// ============================================================================
// Configuration
// ============================================================================

let firestoreEnabled = true;

export const setFirestoreEnabled = (enabled: boolean): void => {
  firestoreEnabled = enabled;
};

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Rediseño censo 2026: rut/age/cqx se mantienen como claves de TableColumnConfig
 * (compatibilidad con configuraciones guardadas y fixtures) pero con ancho 0 porque
 * ya no se renderizan: rut y age viven dentro de la columna "Paciente" (name) y la
 * columna C.QX queda oculta para reactivación futura.
 */
export const DEFAULT_COLUMN_WIDTHS: TableColumnConfig = {
  actions: 22,
  bed: 34,
  type: 30,
  name: 170,
  rut: 0,
  age: 0,
  diagnosis: 123,
  specialty: 45,
  status: 50,
  admission: 51,
  dmi: 67,
  scores: 56,
  cqx: 0,
  upc: 26,
};

export const DEFAULT_PAGE_MARGIN = 12; // px (corresponds to p-3)
// v4: rediseño de identidad visual del censo (columna Paciente unificada, rut/age/cqx en 0).
export const CURRENT_TABLE_CONFIG_VERSION = 4;
export const TABLE_CONFIG_LOCAL_CACHE_KEY = 'hhr.tableConfig.lastKnown';

const COMPACT_COLUMN_MAX_WIDTHS: Readonly<TableColumnConfig> = {
  actions: 22,
  bed: 34,
  type: 28,
  name: 170,
  rut: 0,
  age: 0,
  diagnosis: 123,
  specialty: 45,
  status: 50,
  admission: 51,
  dmi: 67,
  scores: 56,
  cqx: 0,
  upc: 22,
};

// Piso para "name": la columna Paciente unificada (nombre + edad + RUT) necesita
// espacio suficiente aunque la configuración guardada tenga el ancho antiguo (~110).
const MINIMUM_NAME_COLUMN_WIDTH = 170;

const compactColumns = (columns: Partial<TableColumnConfig>): TableColumnConfig => {
  const merged = {
    ...DEFAULT_COLUMN_WIDTHS,
    ...columns,
  } as TableColumnConfig;

  return {
    actions: Math.min(merged.actions, COMPACT_COLUMN_MAX_WIDTHS.actions),
    bed: Math.min(merged.bed, COMPACT_COLUMN_MAX_WIDTHS.bed),
    type: Math.min(merged.type, COMPACT_COLUMN_MAX_WIDTHS.type),
    name: Math.max(
      Math.min(merged.name, COMPACT_COLUMN_MAX_WIDTHS.name),
      MINIMUM_NAME_COLUMN_WIDTH
    ),
    rut: Math.min(merged.rut, COMPACT_COLUMN_MAX_WIDTHS.rut),
    age: Math.min(merged.age, COMPACT_COLUMN_MAX_WIDTHS.age),
    diagnosis: Math.min(merged.diagnosis, COMPACT_COLUMN_MAX_WIDTHS.diagnosis),
    specialty: Math.min(merged.specialty, COMPACT_COLUMN_MAX_WIDTHS.specialty),
    status: Math.min(merged.status, COMPACT_COLUMN_MAX_WIDTHS.status),
    admission: Math.min(merged.admission, COMPACT_COLUMN_MAX_WIDTHS.admission),
    dmi: Math.min(merged.dmi, COMPACT_COLUMN_MAX_WIDTHS.dmi),
    scores: Math.min(merged.scores, COMPACT_COLUMN_MAX_WIDTHS.scores),
    cqx: Math.min(merged.cqx, COMPACT_COLUMN_MAX_WIDTHS.cqx),
    upc: Math.min(merged.upc, COMPACT_COLUMN_MAX_WIDTHS.upc),
  };
};

const migrateTableConfig = (config: Partial<TableConfig>): TableConfig => {
  const resolvedVersion = config.version ?? 0;
  const baseConfig = getDefaultConfig();
  const incomingColumns = config.columns ?? {};

  if (resolvedVersion >= CURRENT_TABLE_CONFIG_VERSION) {
    return {
      ...baseConfig,
      ...config,
      columns: {
        ...DEFAULT_COLUMN_WIDTHS,
        ...config.columns,
      },
      pageMargin: config.pageMargin ?? DEFAULT_PAGE_MARGIN,
      version: resolvedVersion,
    };
  }

  return {
    ...baseConfig,
    ...config,
    columns: compactColumns(incomingColumns),
    pageMargin: config.pageMargin ?? DEFAULT_PAGE_MARGIN,
    version: CURRENT_TABLE_CONFIG_VERSION,
  };
};

export const getDefaultConfig = (): TableConfig => ({
  columns: { ...DEFAULT_COLUMN_WIDTHS },
  pageMargin: DEFAULT_PAGE_MARGIN,
  lastUpdated: new Date().toISOString(),
  version: CURRENT_TABLE_CONFIG_VERSION,
});

const readTableConfigLocalCache = (): Partial<TableConfig> | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    return safeJsonParse<Partial<TableConfig> | null>(
      window.localStorage.getItem(TABLE_CONFIG_LOCAL_CACHE_KEY),
      null
    );
  } catch {
    return null;
  }
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

export const getInitialTableConfig = (): TableConfig => {
  const cachedConfig = readTableConfigLocalCache();
  return cachedConfig ? mergeWithDefaultConfig(cachedConfig) : getDefaultConfig();
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

// ============================================================================
// Export / Import
// ============================================================================

/**
 * Export configuration to JSON file
 */
export const exportTableConfig = (config: TableConfig): void => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `table-config-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Import configuration from JSON file
 */
export const importTableConfig = (file: File): Promise<TableConfig> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const config = safeJsonParse<TableConfig | null>(content, null);
        if (!config) {
          throw new Error('Invalid config format: JSON parse failed');
        }

        // Validate structure
        if (!config.columns || typeof config.columns !== 'object') {
          throw new Error('Invalid config format: missing columns');
        }

        // Merge with defaults
        const validConfig: TableConfig = migrateTableConfig(config);

        resolve(validConfig);
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsText(file);
  });
};
