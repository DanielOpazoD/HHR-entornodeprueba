// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCriticalCoverageReport,
  getCriticalCoverageTestTargets,
} from '../../../scripts/criticalCoverageSupport.mjs';

vi.mock('../../../scripts/gitReportState.mjs', () => ({
  getGitReportState: () => ({ gitSha: 'synthetic', gitDirty: false }),
}));

const temporaryRoots: string[] = [];

const createConfigRoot = (zones: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-coverage-targets-'));
  temporaryRoots.push(root);
  const configDirectory = path.join(root, 'scripts', 'config');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(configDirectory, 'critical-coverage-thresholds.json'),
    JSON.stringify({ zones })
  );
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('critical coverage test targets', () => {
  it('uses explicit coverage tests without expanding a structural test root', () => {
    const root = createConfigRoot({
      'src/example': {
        tests: 'src/tests',
        coverageTests: ['src/tests/example/a.test.ts', 'src/tests/example/b.test.ts'],
      },
    });

    expect(getCriticalCoverageTestTargets(root)).toEqual([
      'src/tests/example/a.test.ts',
      'src/tests/example/b.test.ts',
    ]);
  });

  it('falls back to the structural test target for unchanged zones', () => {
    const root = createConfigRoot({
      'src/example': {
        tests: 'src/tests/example',
      },
    });

    expect(getCriticalCoverageTestTargets(root)).toEqual(['src/tests/example']);
  });

  it('deduplicates shared coverage targets across zones', () => {
    const root = createConfigRoot({
      'src/one': {
        tests: 'src/tests/one',
        coverageTests: ['src/tests/shared.test.ts'],
      },
      'src/two': {
        tests: 'src/tests/two',
        coverageTests: ['src/tests/shared.test.ts'],
      },
    });

    expect(getCriticalCoverageTestTargets(root)).toEqual(['src/tests/shared.test.ts']);
  });
});

const writeFixtureFile = (root: string, relative: string) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export {};');
};

const writeCoverage = (root: string, files: string[], hits = 1) => {
  const coverage = Object.fromEntries(
    files.map(relative => {
      const file = path.join(root, relative);
      return [
        file,
        {
          path: file,
          statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } } },
          fnMap: {
            0: {
              name: 'example',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
              line: 1,
            },
          },
          branchMap: {
            0: {
              type: 'if',
              line: 1,
              loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
              locations: [
                { start: { line: 1, column: 0 }, end: { line: 1, column: 6 } },
                { start: { line: 1, column: 6 }, end: { line: 1, column: 12 } },
              ],
            },
          },
          s: { 0: hits },
          f: { 0: hits },
          b: { 0: [hits, hits] },
        },
      ];
    })
  );
  fs.mkdirSync(path.join(root, 'coverage/critical'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'coverage/critical/coverage-final.json'),
    JSON.stringify(coverage)
  );
};

const createCoveredOwnerRoot = () => {
  const root = createConfigRoot({
    'src/owner': {
      tests: 'src/tests/owner',
      coverageBaseline: { lines: 90, functions: 90, branches: 90 },
    },
  });
  writeFixtureFile(root, 'src/owner/index.ts');
  writeFixtureFile(root, 'src/tests/owner/a.test.ts');
  writeCoverage(root, ['src/owner/index.ts']);
  return root;
};

describe('critical coverage ownership and instrumentation', () => {
  it('allows consolidating owner tests while keeping identical instrumented coverage', () => {
    const root = createCoveredOwnerRoot();
    writeFixtureFile(root, 'src/tests/owner/b.test.ts');
    const before = buildCriticalCoverageReport(root);
    expect(before.status).toBe('passing');
    fs.rmSync(path.join(root, 'src/tests/owner/b.test.ts'));
    const after = buildCriticalCoverageReport(root);
    expect(after.status).toBe('passing');
    expect(after.criticalZones[0].testFileCount).toBe(1);
    expect(after.criticalZones[0].coverage).toEqual(before.criticalZones[0].coverage);
    expect(after.criticalZones[0].coverageBaseline).toEqual(
      before.criticalZones[0].coverageBaseline
    );
  });

  it('requires an owner test even when unrelated tests and complete coverage exist', () => {
    const root = createCoveredOwnerRoot();
    fs.rmSync(path.join(root, 'src/tests/owner/a.test.ts'));
    writeFixtureFile(root, 'src/tests/unrelated/a.test.ts');
    const zone = buildCriticalCoverageReport(root).criticalZones[0];
    expect(zone.coverageGate.passed).toBe(true);
    expect(zone.structuralGate.failures).toEqual([
      'No owner test files were discovered for the zone.',
    ]);
    expect(zone.passed).toBe(false);
  });

  it('rejects removing source instrumentation despite enough owner test files', () => {
    const root = createCoveredOwnerRoot();
    writeFixtureFile(root, 'src/owner/second.ts');
    const zone = buildCriticalCoverageReport(root).criticalZones[0];
    expect(zone.structuralGate.passed).toBe(true);
    expect(zone.coverage.missingFiles).toEqual(['src/owner/second.ts']);
    expect(zone.passed).toBe(false);
  });

  it('rejects a metric regression with unchanged source and test counts', () => {
    const root = createCoveredOwnerRoot();
    writeCoverage(root, ['src/owner/index.ts'], 0);
    const zone = buildCriticalCoverageReport(root).criticalZones[0];
    expect(zone.structuralGate.passed).toBe(true);
    expect(zone.coverageGate.failures).toEqual([
      'lines 0.0% < baseline 90.0%.',
      'functions 0.0% < baseline 90.0%.',
      'branches 0.0% < baseline 90.0%.',
    ]);
    expect(zone.passed).toBe(false);
  });

  it('rejects a zone whose configured sources disappeared', () => {
    const root = createCoveredOwnerRoot();
    fs.rmSync(path.join(root, 'src/owner/index.ts'));
    expect(buildCriticalCoverageReport(root).criticalZones[0].structuralGate.failures).toEqual([
      'No source files were discovered for the zone.',
    ]);
  });

  it('counts overlapping owner selectors once for advisory reporting', () => {
    const root = createConfigRoot({
      'src/owner': {
        tests: ['src/tests/owner', 'src/tests/owner/a.test.ts', 'src/tests/helper.ts'],
      },
    });
    writeFixtureFile(root, 'src/owner/index.ts');
    writeFixtureFile(root, 'src/tests/owner/a.test.ts');
    writeFixtureFile(root, 'src/tests/helper.ts');
    expect(buildCriticalCoverageReport(root).criticalZones[0].testFileCount).toBe(1);
  });

  it('keeps queue load nightly-only while retaining the deterministic drain in critical coverage', async () => {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      path.resolve('vitest.critical-coverage.config.ts')
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.config.test?.include).toContain('src/tests/**/*.test.ts');
    expect(loaded?.config.test?.exclude).toContain(
      'src/tests/services/storage/syncQueueLoad.test.ts'
    );
    expect(loaded?.config.test?.exclude).not.toContain(
      'src/tests/services/storage/syncQueueDrain.test.ts'
    );
  });
});

describe('critical coverage process outcome', () => {
  const runner = path.resolve('scripts/run-critical-coverage.mjs');

  const runFixture = (childSource: string, targets = ['src/tests/example.test.ts']) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-coverage-runner-'));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts/config/critical-coverage-thresholds.json'),
      JSON.stringify({
        zones: targets.length ? { 'src/example': { coverageTests: targets } } : {},
      })
    );
    fs.writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), childSource);
    return spawnSync(process.execPath, [runner], {
      cwd: root,
      env: { ...process.env, VITEST_MAX_WORKERS: '2' },
      encoding: 'utf8',
      timeout: 10000,
    });
  };

  it.each([
    ['success', 'process.exit(0)', 0],
    ['failed tests', 'process.exit(7)', 7],
    ['terminated child', "process.kill(process.pid, 'SIGTERM')", 1],
  ])('preserves %s without approving an incomplete run', (_label, source, status) => {
    const result = runFixture(source);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
    if (status === 1) {
      expect(result.stderr).toContain('[critical-coverage] Runner did not complete: SIGTERM');
    }
  });

  it('preserves the full target selection and forwards the existing Vitest worker setting', () => {
    const result = runFixture(
      'console.log(JSON.stringify({args:process.argv.slice(2),workers:process.env.VITEST_MAX_WORKERS}))',
      ['src/tests/first.test.ts', 'src/tests/second.test.ts']
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      args: [
        'run',
        '-c',
        'vitest.critical-coverage.config.ts',
        'src/tests/first.test.ts',
        'src/tests/second.test.ts',
      ],
      workers: '2',
    });
  });

  it('rejects an empty target set before starting Vitest', () => {
    const result = runFixture("console.log('CHILD_STARTED')", []);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No critical coverage test targets were configured');
    expect(result.stdout).not.toContain('CHILD_STARTED');
  });
});
