import type { AuditTrailCategory, AuditTrailGrouping } from '@/types/auditTrailTypes';
import {
  AUDIT_TRAIL_CATEGORY_ORDER,
  AUDIT_TRAIL_GROUPING_ORDER,
} from '@/services/admin/auditTrail/auditTrailCatalog';

export type AuditTrailDensity = 'compact' | 'comfortable';

export interface AuditTrailColumns {
  document: boolean;
  bed: boolean;
  device: boolean;
}

/** What each person chooses to see; kept on this device across logins. */
export interface AuditTrailViewPreferences {
  grouping: AuditTrailGrouping;
  categories: AuditTrailCategory[];
  density: AuditTrailDensity;
  columns: AuditTrailColumns;
  expandGroups: boolean;
}

export const AUDIT_TRAIL_VIEW_STORAGE_KEY = 'hhr_audit_trail_view_v1';

export const DEFAULT_AUDIT_TRAIL_VIEW: AuditTrailViewPreferences = {
  grouping: 'patient',
  categories: ['change', 'access'],
  density: 'compact',
  columns: { document: true, bed: true, device: false },
  expandGroups: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export const parseAuditTrailViewPreferences = (
  raw: string | null | undefined
): AuditTrailViewPreferences => {
  if (!raw) return DEFAULT_AUDIT_TRAIL_VIEW;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_AUDIT_TRAIL_VIEW;
  }
  if (!isRecord(parsed)) return DEFAULT_AUDIT_TRAIL_VIEW;

  const defaults = DEFAULT_AUDIT_TRAIL_VIEW;
  const columns = isRecord(parsed.columns) ? parsed.columns : {};
  const categories = Array.isArray(parsed.categories)
    ? AUDIT_TRAIL_CATEGORY_ORDER.filter(category =>
        (parsed as { categories: unknown[] }).categories.includes(category)
      )
    : defaults.categories;

  return {
    grouping: AUDIT_TRAIL_GROUPING_ORDER.includes(parsed.grouping as AuditTrailGrouping)
      ? (parsed.grouping as AuditTrailGrouping)
      : defaults.grouping,
    categories,
    density: parsed.density === 'comfortable' ? 'comfortable' : 'compact',
    columns: {
      document: readBoolean(columns.document, defaults.columns.document),
      bed: readBoolean(columns.bed, defaults.columns.bed),
      device: readBoolean(columns.device, defaults.columns.device),
    },
    expandGroups: readBoolean(parsed.expandGroups, defaults.expandGroups),
  };
};

export const serializeAuditTrailViewPreferences = (
  preferences: AuditTrailViewPreferences
): string => JSON.stringify(preferences);
