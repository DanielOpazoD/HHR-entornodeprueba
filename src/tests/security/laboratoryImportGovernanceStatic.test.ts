import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');

describe('Laboratory import governance', () => {
  it('keeps external modules out of deep laboratory imports', () => {
    // Use the same boundary policy as CI, including its exact importer allowlist.
    // A second grep policy incorrectly rejects governed lightweight entry points.
    expect(() =>
      execFileSync(process.execPath, ['scripts/check-feature-public-api-boundary.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    ).not.toThrow();
  });
});
