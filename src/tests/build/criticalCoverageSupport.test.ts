// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('critical structural test ownership', () => {
  it('cannot satisfy a zone minimum with unrelated application tests', () => {
    const tests = [
      'src/tests/owner/a.test.ts',
      'src/tests/owner/b.test.ts',
      'src/tests/owner/c.test.ts',
      'src/tests/owner/d.test.ts',
    ];
    const root = createConfigRoot({
      'src/owner': { tests, minTestFileCount: 4, minTestToSourceRatio: 1 },
    });
    writeFixtureFile(root, 'src/owner/index.ts');
    for (const file of tests.slice(0, 3)) writeFixtureFile(root, file);
    for (let index = 0; index < 20; index += 1)
      writeFixtureFile(root, `src/tests/unrelated/${index}.test.ts`);
    const before = buildCriticalCoverageReport(root).criticalZones[0];
    expect(before.testFileCount).toBe(3);
    expect(before.structuralGate.passed).toBe(false);
    expect(before.structuralGate.failures).toContain('Test files 3 < required minimum 4.');
    writeFixtureFile(root, tests[3]);
    const after = buildCriticalCoverageReport(root).criticalZones[0];
    expect(after.testFileCount).toBe(4);
    expect(after.structuralGate.passed).toBe(true);
  });

  it('deduplicates overlapping directories and file selectors and ignores missing/non-test files', () => {
    const root = createConfigRoot({
      'src/owner': {
        tests: [
          'src/tests/owner',
          'src/tests/owner/a.test.ts',
          'src/tests/owner',
          'src/tests/missing.test.ts',
          'src/tests/helper.ts',
        ],
        minTestFileCount: 2,
        minTestToSourceRatio: 1,
      },
    });
    writeFixtureFile(root, 'src/owner/index.ts');
    writeFixtureFile(root, 'src/tests/owner/a.test.ts');
    writeFixtureFile(root, 'src/tests/helper.ts');
    const zone = buildCriticalCoverageReport(root).criticalZones[0];
    expect(zone.testFileCount).toBe(1);
    expect(zone.structuralGate.passed).toBe(false);
  });

  it('preserves counting within an existing directory selector', () => {
    const root = createConfigRoot({
      'src/owner': { tests: 'src/tests/owner', minTestFileCount: 2, minTestToSourceRatio: 1 },
    });
    writeFixtureFile(root, 'src/owner/index.ts');
    writeFixtureFile(root, 'src/tests/owner/a.test.ts');
    writeFixtureFile(root, 'src/tests/owner/nested/b.spec.tsx');
    writeFixtureFile(root, 'src/tests/outside/c.test.ts');
    const zone = buildCriticalCoverageReport(root).criticalZones[0];
    expect(zone.testFileCount).toBe(2);
    expect(zone.structuralGate.passed).toBe(true);
  });
});
