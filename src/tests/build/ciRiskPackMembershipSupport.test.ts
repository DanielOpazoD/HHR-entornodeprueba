import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  extractExcludePatterns,
  resolveUnitSuiteExcludePatterns,
} from '../../../scripts/ciRiskPackMembershipSupport.mjs';

const tempRoots: string[] = [];

const createTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-ci-risk-pack-'));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('ci risk pack membership support', () => {
  it('extracts exclusions from the legacy Vitest shard command', () => {
    expect(
      extractExcludePatterns(
        'vitest run --exclude "src/tests/security/firestore-rules.test.ts" --exclude src/tests/emulator/** --shard'
      )
    ).toEqual(['src/tests/security/firestore-rules.test.ts', 'src/tests/emulator/**']);
  });

  it('resolves exclusions from the unit shard balance contract when the shard runner is used', () => {
    const root = createTempRoot();
    const configDir = path.join(root, 'scripts/config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'unit-shard-balance.json'),
      JSON.stringify({
        excludedFromUnitSuite: [
          'src/tests/security/firestore-rules.test.ts',
          'src/tests/emulator/**',
          'src/tests/emulator-ui/**',
        ],
      })
    );

    expect(
      resolveUnitSuiteExcludePatterns({
        root,
        scriptCommand: 'node scripts/run-unit-shard.mjs',
      })
    ).toEqual([
      'src/tests/security/firestore-rules.test.ts',
      'src/tests/emulator/**',
      'src/tests/emulator-ui/**',
    ]);
  });
});
