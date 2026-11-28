/**
 * Table Configuration Defaults & Local Cache Hydration
 * Pure synchronous defaults, migration, and localStorage hydration for census table widths.
 * Kept free of Firebase/Firestore imports so `app-authenticated-shell` never pulls
 * remote settings sync into the initial authenticated shell chunk.
 */

import { safeJsonParse } from '@/utils/jsonUtils';

export interface TableColumnConfig {
  actions: number; // Column for action buttons (demo, menu)
  bed: number;
  type: number;
  name: number;
  /** «Accesos»: ficha, laboratorio, imágenes y documentos del paciente, in a 2×2 grid. */
  access: number;
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
  /**
   * The census shows Braden and Downton unless an admin turns them off for everyone in
   * Configuración › Visual (2026-11-04): nursing reports those scales in the chart alerts.
   */
  nursingScalesVisible?: boolean;
  lastUpdated: string;
  version: number;
}

/**
 * Rediseño censo 2026: rut/age/cqx se mantienen como claves de TableColumnConfig
 * (compatibilidad con configuraciones guardadas y fixtures) pero con ancho 0 porque
 * ya no se renderizan: rut y age viven dentro de la columna "Paciente" (name) y la
 * columna C.QX queda oculta para reactivación futura.
 */
// Rediseño censo 2026 "centro de vigilancia": `status` se reduce a un punto de color (dot + popover),
// `admission` se reutiliza como columna de Signos Vitales (PA·FC·SAT·T°, necesita más ancho) y `scores`
// crece para los nombres completos de las escalas ("Braden 17"). La fecha de ingreso vive en Paciente.
export const DEFAULT_COLUMN_WIDTHS: TableColumnConfig = {
  actions: 22,
  bed: 28,
  type: 30,
  name: 150,
  access: 64,
  rut: 0,
  age: 0,
  diagnosis: 123,
  specialty: 45,
  status: 16,
  admission: 96,
  dmi: 67,
  scores: 92,
  cqx: 0,
  upc: 26,
};

export const DEFAULT_PAGE_MARGIN = 12; // px (corresponds to p-3)
// v5: rediseño "centro de vigilancia" — Estado como punto, columna Signos Vitales, Scores con nombres.
// v6: Estado (punto) y Paciente más compactos (status 28→20, name 172→150).
// v7: Estado y Cama aún más angostos (status 20→16, bed 34→28).
export const CURRENT_TABLE_CONFIG_VERSION = 7;
export const TABLE_CONFIG_LOCAL_CACHE_KEY = 'hhr.tableConfig.lastKnown';

const COMPACT_COLUMN_MAX_WIDTHS: Readonly<TableColumnConfig> = {
  actions: 22,
  bed: 28,
  type: 28,
  name: 150,
  access: 64,
  rut: 0,
  age: 0,
  diagnosis: 123,
  specialty: 45,
  status: 16,
  admission: 96,
  dmi: 67,
  scores: 92,
  cqx: 0,
  upc: 22,
};

// Piso para "name": la columna Paciente unificada (nombre + edad + RUT) necesita
// espacio suficiente aunque la configuración guardada tenga el ancho antiguo (~110).
// v6: bajado a 150 para permitir la columna Paciente más angosta (el nombre trunca).
const MINIMUM_NAME_COLUMN_WIDTH = 150;

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
    access: Math.min(merged.access, COMPACT_COLUMN_MAX_WIDTHS.access),
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

export const getDefaultConfig = (): TableConfig => ({
  columns: { ...DEFAULT_COLUMN_WIDTHS },
  pageMargin: DEFAULT_PAGE_MARGIN,
  lastUpdated: new Date().toISOString(),
  version: CURRENT_TABLE_CONFIG_VERSION,
});

export const migrateTableConfig = (config: Partial<TableConfig>): TableConfig => {
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

export const getInitialTableConfig = (): TableConfig => {
  const cachedConfig = readTableConfigLocalCache();
  return cachedConfig ? migrateTableConfig(cachedConfig) : getDefaultConfig();
};

export const isE2ETableConfigRemoteDisabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as Window & { __HHR_E2E_OVERRIDE__?: unknown }).__HHR_E2E_OVERRIDE__ ||
    window.localStorage?.getItem('hhr_e2e_bootstrap_user')
  );
};
