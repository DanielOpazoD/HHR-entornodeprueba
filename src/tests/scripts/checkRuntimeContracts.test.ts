// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-runtime-contracts.mjs');
const roots: string[] = [];

const REGISTRY = `const schemaMigrators: Record<number, SchemaMigrator> = {
  0: record => record,
  1: record => record,
};
`;

/** A synthetic repository whose contracts agree: schema v0 → v2, runtime contract 3. */
const consistentFiles = (): Record<string, string> => ({
  'src/constants/runtimeContracts.ts': [
    'export const CLIENT_RUNTIME_CONTRACT_VERSION = 3;',
    'export const BACKEND_RUNTIME_CONTRACT_VERSION = 3;',
    'export const MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION = 3;',
    'export const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 3;',
  ].join('\n'),
  'src/constants/version.ts':
    'export const LEGACY_SCHEMA_VERSION = 0;\nexport const CURRENT_SCHEMA_VERSION = 2;\n',
  'functions/lib/runtime/runtimeContract.js': [
    'const BACKEND_RUNTIME_CONTRACT_VERSION = 3;',
    'const MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION = 3;',
    'const SUPPORTED_SCHEMA_VERSION = 2;',
    'const LEGACY_SCHEMA_FLOOR_VERSION = 0;',
  ].join('\n'),
  'src/services/repositories/migrationLedger.ts':
    '[{ fromVersion: 0, toVersion: 1 }, { fromVersion: 1, toVersion: 2 }];\n',
  'src/services/repositories/schemaGovernance.ts': REGISTRY,
  'src/services/repositories/README.md':
    'schemaEvolutionPolicy.ts, migrationLedger.ts y dataMigration.ts.\n',
});

const runGuard = (overrides: Record<string, string> = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-runtime-contracts-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries({ ...consistentFiles(), ...overrides })) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The schema cases below were check:schema-governance before it was folded in (W13-A3).
describe('check-runtime-contracts', () => {
  it('accepts consistent runtime and schema contracts', () => {
    const { status, output } = runGuard();

    expect(output).toContain('[runtime-contracts] OK');
    expect(output).toContain('migrators=[0, 1]');
    expect(status).toBe(0);
  });

  it.each([
    [
      'a missing migrator step',
      REGISTRY.replace('  1: record => record,\n', ''),
      'missing [1], extra []',
    ],
    [
      'a migrator beyond the current schema',
      REGISTRY.replace('};', '  2: record => record,\n};'),
      'missing [], extra [2]',
    ],
    [
      'no migrator registry',
      REGISTRY.replace('schemaMigrators', 'otherMigrators'),
      'schemaMigrators registry not found',
    ],
  ])('rejects %s', (_case, registry, message) => {
    const { status, output } = runGuard({
      'src/services/repositories/schemaGovernance.ts': registry,
    });

    expect(status).toBe(1);
    expect(output).toContain(message);
  });

  it('rejects a legacy schema newer than the current one', () => {
    const { status, output } = runGuard({
      'src/constants/version.ts':
        'export const LEGACY_SCHEMA_VERSION = 3;\nexport const CURRENT_SCHEMA_VERSION = 2;\n',
      'functions/lib/runtime/runtimeContract.js': consistentFiles()[
        'functions/lib/runtime/runtimeContract.js'
      ].replace('LEGACY_SCHEMA_FLOOR_VERSION = 0', 'LEGACY_SCHEMA_FLOOR_VERSION = 3'),
      'src/services/repositories/migrationLedger.ts': '[{ fromVersion: 3, toVersion: 2 }];\n',
    });

    expect(status).toBe(1);
    expect(output).toContain(
      'LEGACY_SCHEMA_VERSION (3) cannot be greater than CURRENT_SCHEMA_VERSION (2)'
    );
  });

  it('rejects a repository README that no longer names the migration files', () => {
    const { status, output } = runGuard({
      'src/services/repositories/README.md': 'schemaEvolutionPolicy.ts y dataMigration.ts.\n',
    });

    expect(status).toBe(1);
    expect(output).toContain('README.md must still name migrationLedger.ts');
  });
});
