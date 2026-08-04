import { Timestamp } from 'firebase/firestore';

/** Global, fail-safe policy for applying Eloísa census imports. */

export type RayenImportMode = 'preview' | 'auto';

export interface RayenImportPolicy {
  mode: RayenImportMode;
  revision: number;
}

export const RAYEN_IMPORT_POLICY_SCHEMA_VERSION = 1;
export const DEFAULT_RAYEN_IMPORT_MODE: RayenImportMode = 'preview';
export const DEFAULT_RAYEN_IMPORT_POLICY: Readonly<RayenImportPolicy> = Object.freeze({
  mode: DEFAULT_RAYEN_IMPORT_MODE,
  revision: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const RAYEN_IMPORT_POLICY_FIELDS = new Set([
  'schemaVersion',
  'mode',
  'revision',
  'updatedAt',
  'updatedByUid',
]);

/**
 * Converts a persisted policy into the small operational contract used by a sync run.
 * Invalid or legacy payloads are deliberately rejected instead of enabling automation.
 */
export const normalizeRayenImportPolicy = (value: unknown): RayenImportPolicy | null => {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some(field => !RAYEN_IMPORT_POLICY_FIELDS.has(field))) return null;
  if (value.schemaVersion !== RAYEN_IMPORT_POLICY_SCHEMA_VERSION) return null;
  if (value.mode !== 'preview' && value.mode !== 'auto') return null;
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) return null;
  if (typeof value.updatedByUid !== 'string' || value.updatedByUid.trim().length === 0) return null;
  if (!(value.updatedAt instanceof Timestamp)) return null;
  return { mode: value.mode, revision: Number(value.revision) };
};
