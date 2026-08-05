import { Timestamp } from 'firebase/firestore';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
export type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';

/** Global, fail-safe policy for applying Eloísa census imports. */

export type RayenImportMode = 'preview' | 'auto';

export interface RayenImportPolicy {
  mode: RayenImportMode;
  clinicalBatchMode: ClinicalEnrichmentBatchMode;
  revision: number;
}

export const RAYEN_IMPORT_POLICY_SCHEMA_VERSION = 2;
export const DEFAULT_RAYEN_IMPORT_MODE: RayenImportMode = 'preview';
export const DEFAULT_RAYEN_CLINICAL_BATCH_MODE: ClinicalEnrichmentBatchMode = 'off';
export const DEFAULT_RAYEN_IMPORT_POLICY: Readonly<RayenImportPolicy> = Object.freeze({
  mode: DEFAULT_RAYEN_IMPORT_MODE,
  clinicalBatchMode: DEFAULT_RAYEN_CLINICAL_BATCH_MODE,
  revision: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const RAYEN_IMPORT_POLICY_V1_FIELDS = new Set([
  'schemaVersion',
  'mode',
  'revision',
  'updatedAt',
  'updatedByUid',
]);
const RAYEN_IMPORT_POLICY_V2_FIELDS = new Set([
  ...RAYEN_IMPORT_POLICY_V1_FIELDS,
  'clinicalBatchMode',
]);

const hasOnlyFields = (value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean =>
  !Object.keys(value).some(field => !allowed.has(field));

const hasValidMetadata = (value: Record<string, unknown>): boolean =>
  Number.isInteger(value.revision) &&
  Number(value.revision) >= 1 &&
  typeof value.updatedByUid === 'string' &&
  value.updatedByUid.trim().length > 0 &&
  value.updatedAt instanceof Timestamp;

const isClinicalBatchMode = (value: unknown): value is ClinicalEnrichmentBatchMode =>
  value === 'off' || value === 'shadow' || value === 'enforced';

/**
 * Converts a persisted policy into the small operational contract used by a sync run.
 * Schema v1 is accepted only as an explicit compatibility state with the clinical batch disabled.
 * Invalid payloads are rejected instead of enabling either automatic import or batch authority.
 */
export const normalizeRayenImportPolicy = (value: unknown): RayenImportPolicy | null => {
  if (!isRecord(value)) return null;
  if (value.mode !== 'preview' && value.mode !== 'auto') return null;
  if (!hasValidMetadata(value)) return null;

  if (value.schemaVersion === 1 && hasOnlyFields(value, RAYEN_IMPORT_POLICY_V1_FIELDS)) {
    return {
      mode: value.mode,
      clinicalBatchMode: DEFAULT_RAYEN_CLINICAL_BATCH_MODE,
      revision: Number(value.revision),
    };
  }
  if (
    value.schemaVersion !== RAYEN_IMPORT_POLICY_SCHEMA_VERSION ||
    !hasOnlyFields(value, RAYEN_IMPORT_POLICY_V2_FIELDS) ||
    !isClinicalBatchMode(value.clinicalBatchMode)
  ) {
    return null;
  }
  return {
    mode: value.mode,
    clinicalBatchMode: value.clinicalBatchMode,
    revision: Number(value.revision),
  };
};
