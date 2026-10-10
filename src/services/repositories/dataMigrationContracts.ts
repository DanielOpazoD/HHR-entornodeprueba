import { DailyRecord } from '@/types/domain/dailyRecord';
import type { SchemaMigrationPlan } from '@/services/repositories/schemaGovernance';
import type { SchemaCompatibilityDisposition } from '@/services/repositories/schemaEvolutionPolicy';

export type LegacyMigrationRule =
  | 'schema_defaults_applied'
  | 'legacy_nulls_normalized'
  | 'salvage_patient_fallback_applied'
  | 'record_invariants_normalized'
  | 'legacy_nurses_promoted_to_day_shift'
  | 'legacy_single_nurse_promoted'
  | 'legacy_tens_promoted_to_day_shift'
  | 'schema_version_floor_enforced';

export type MigrationCompatibilityIntensity =
  | 'none'
  | 'normalized_only'
  | 'legacy_staff_promoted'
  | 'legacy_schema_bridge';

export interface DailyRecordMigrationResult {
  record: DailyRecord;
  appliedRules: LegacyMigrationRule[];
  recoveredIssues: string[];
  compatibilityIntensity: MigrationCompatibilityIntensity;
  schemaPlan: SchemaMigrationPlan;
  compatibilityDisposition: SchemaCompatibilityDisposition;
}
