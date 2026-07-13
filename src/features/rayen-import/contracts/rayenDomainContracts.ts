/**
 * Single, auditable surface for the HHR domain "hotspot" types this feature consumes.
 * The rest of rayen-import imports PatientData / DailyRecord from here instead of from
 * `@/types/domain/*` directly, keeping the domain-hotspot boundary a thin, explicit
 * re-export (see scripts/config/domain-hotspot-boundary-baseline.json).
 */

export type { PatientData } from '@/types/domain/patient';
export type { DailyRecord, RayenSyncMeta } from '@/types/domain/dailyRecord';
