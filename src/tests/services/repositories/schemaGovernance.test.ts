import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from '@/constants/version';
import {
  assertSchemaGovernanceIntegrity,
  getSchemaGovernanceIntegrity,
  getSchemaMigratorRegistry,
  isSchemaVersionAhead,
  migrateRecordSchemaToCurrent,
  resolveSchemaVersion,
} from '@/services/repositories/schemaGovernance';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (schemaVersion?: number): DailyRecord => ({
  date: '2025-01-01',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2025-01-01T00:00:00.000Z',
  nurses: ['', ''],
  activeExtraBeds: [],
  schemaVersion,
});

describe('schemaGovernance', () => {
  it('resolves legacy version when schemaVersion is missing', () => {
    const version = resolveSchemaVersion({});
    expect(version).toBe(LEGACY_SCHEMA_VERSION);
  });

  it('migrates legacy records to current schema version', () => {
    const legacy = makeRecord(undefined);
    const result = migrateRecordSchemaToCurrent(legacy, legacy.date);

    expect(result.record.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.plan.sourceVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(result.plan.targetVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.plan.appliedSteps).toContain('v0->v1');
    expect(result.plan.skipped).toBe(false);
    expect(result.plan.disposition).toBe('legacy_bridge');
  });

  it('keeps future versions untouched and flags migration skip', () => {
    const future = makeRecord(CURRENT_SCHEMA_VERSION + 1);
    const result = migrateRecordSchemaToCurrent(future, future.date);

    expect(result.record.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(result.plan.skipped).toBe(true);
    expect(result.plan.appliedSteps).toEqual([]);
    expect(isSchemaVersionAhead(result.record)).toBe(true);
    expect(result.plan.disposition).toBe('forward_incompatible');
  });

  it('normalizes invalid negative versions to legacy baseline', () => {
    const negative = makeRecord(-3);
    const result = migrateRecordSchemaToCurrent(negative, negative.date);

    expect(result.plan.sourceVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(result.record.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('exposes a contiguous migrator registry compatible with current schema', () => {
    const integrity = getSchemaGovernanceIntegrity();
    const registry = getSchemaMigratorRegistry();

    expect(integrity.ok).toBe(true);
    expect(integrity.missingMigrators).toEqual([]);
    expect(integrity.extraMigrators).toEqual([]);
    expect(
      Object.keys(registry)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual(integrity.expectedMigratorKeys);
  });

  it('asserts schema governance integrity without throwing for valid config', () => {
    expect(() => assertSchemaGovernanceIntegrity()).not.toThrow();
  });
});
