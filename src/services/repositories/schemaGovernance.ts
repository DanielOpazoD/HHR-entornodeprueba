import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from '@/constants/version';
import { DailyRecord } from '@/types/domain/dailyRecord';
import { getSchemaEvolutionLedger } from '@/services/repositories/migrationLedger';
import { assessSchemaCompatibility } from '@/services/repositories/schemaEvolutionPolicy';

export interface SchemaMigrationPlan {
  sourceVersion: number;
  targetVersion: number;
  appliedSteps: string[];
  skipped: boolean;
  disposition: 'current' | 'migrate' | 'forward_incompatible' | 'legacy_bridge';
}

export type SchemaMigrationInput = Partial<DailyRecord>;

export interface SchemaMigrationResult<
  TRecord extends SchemaMigrationInput = SchemaMigrationInput,
> {
  record: TRecord;
  plan: SchemaMigrationPlan;
}

type SchemaMigrator = <TRecord extends SchemaMigrationInput>(
  record: TRecord,
  date: string
) => TRecord;

const schemaMigrators: Record<number, SchemaMigrator> = {
  0: record => ({
    ...record,
    schemaVersion: 1,
  }),
};

export interface SchemaGovernanceIntegrity {
  ok: boolean;
  currentVersion: number;
  legacyVersion: number;
  expectedMigratorKeys: number[];
  configuredMigratorKeys: number[];
  missingMigrators: number[];
  extraMigrators: number[];
}

export const getSchemaMigratorRegistry = (): Readonly<Record<number, SchemaMigrator>> =>
  schemaMigrators;

export const getSchemaGovernanceIntegrity = (): SchemaGovernanceIntegrity => {
  const configuredMigratorKeys = Object.keys(schemaMigrators)
    .map(key => Number(key))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const expectedMigratorKeys: number[] = [];
  for (let version = LEGACY_SCHEMA_VERSION; version < CURRENT_SCHEMA_VERSION; version += 1) {
    expectedMigratorKeys.push(version);
  }

  const missingMigrators = expectedMigratorKeys.filter(
    key => !configuredMigratorKeys.includes(key)
  );
  const extraMigrators = configuredMigratorKeys.filter(key => !expectedMigratorKeys.includes(key));

  return {
    ok: missingMigrators.length === 0 && extraMigrators.length === 0,
    currentVersion: CURRENT_SCHEMA_VERSION,
    legacyVersion: LEGACY_SCHEMA_VERSION,
    expectedMigratorKeys,
    configuredMigratorKeys,
    missingMigrators,
    extraMigrators,
  };
};

export const assertSchemaGovernanceIntegrity = (): void => {
  const integrity = getSchemaGovernanceIntegrity();
  if (integrity.ok) return;

  throw new Error(
    `[SchemaGovernance] Invalid migrator registry. ` +
      `Missing: [${integrity.missingMigrators.join(', ')}]. ` +
      `Extra: [${integrity.extraMigrators.join(', ')}]. ` +
      `Expected keys for v${integrity.legacyVersion}..v${integrity.currentVersion - 1}.`
  );
};

export const resolveSchemaVersion = (record: Partial<DailyRecord> | null | undefined): number => {
  const rawVersion = record?.schemaVersion;
  if (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion)) {
    return LEGACY_SCHEMA_VERSION;
  }
  if (rawVersion < LEGACY_SCHEMA_VERSION) {
    return LEGACY_SCHEMA_VERSION;
  }
  return Math.floor(rawVersion);
};

export const migrateRecordSchemaToCurrent = <TRecord extends SchemaMigrationInput = DailyRecord>(
  record: TRecord,
  date: string
): SchemaMigrationResult<TRecord> => {
  const compatibility = assessSchemaCompatibility(record);
  const sourceVersion = compatibility.sourceVersion;

  if (sourceVersion >= CURRENT_SCHEMA_VERSION) {
    return {
      record: {
        ...record,
        schemaVersion: sourceVersion,
      },
      plan: {
        sourceVersion,
        targetVersion: CURRENT_SCHEMA_VERSION,
        appliedSteps: [],
        skipped: sourceVersion > CURRENT_SCHEMA_VERSION,
        disposition: compatibility.disposition,
      },
    };
  }

  let cursor = sourceVersion;
  let migrated = record;
  const appliedSteps: string[] = [];

  while (cursor < CURRENT_SCHEMA_VERSION) {
    const migrator = schemaMigrators[cursor];
    if (!migrator) {
      throw new Error(
        `[SchemaGovernance] Missing schema migrator from v${cursor} to v${cursor + 1}.`
      );
    }

    migrated = migrator(migrated, date);
    const ledgerStep = getSchemaEvolutionLedger().find(
      step => step.fromVersion === cursor && step.toVersion === cursor + 1
    );
    appliedSteps.push(ledgerStep?.label || `v${cursor}->v${cursor + 1}`);
    cursor += 1;
  }

  return {
    record: {
      ...migrated,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
    plan: {
      sourceVersion,
      targetVersion: CURRENT_SCHEMA_VERSION,
      appliedSteps,
      skipped: false,
      disposition: compatibility.disposition,
    },
  };
};

export const isSchemaVersionAhead = (record: Partial<DailyRecord> | null | undefined): boolean =>
  resolveSchemaVersion(record) > CURRENT_SCHEMA_VERSION;
