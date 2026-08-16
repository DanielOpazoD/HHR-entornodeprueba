import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getCriticalCoverageTestTargets } from '../../../scripts/criticalCoverageSupport.mjs';

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
