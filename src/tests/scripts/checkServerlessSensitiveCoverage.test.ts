// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const GUARD = path.resolve('scripts/check-serverless-sensitive-coverage.mjs');
const CONFIG = 'scripts/config/serverless-sensitive-coverage.json';
const roots: string[] = [];
const entry = {
  id: 'clinical',
  functionFile: 'netlify/functions/clinical.ts',
  endpoint: 'clinical',
  testFiles: ['src/tests/clinical.test.ts'],
};
const runGuard = (
  config: { entries: (typeof entry)[]; exempt: { functionFile: string; reason?: string }[] } = {
    entries: [entry],
    exempt: [],
  },
  files: Record<string, string> = {}
) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hhr-sensitive-coverage-'));
  roots.push(root);
  const tree = {
    [entry.functionFile]: 'export const handler = () => {};',
    [entry.testFiles[0]]: '// synthetic behavior test',
    'docs/contracts.md': '`clinical`',
    ...files,
    [CONFIG]: JSON.stringify({ contractsDoc: 'docs/contracts.md', ...config }),
  };
  for (const [file, content] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-serverless-sensitive-coverage', () => {
  it('preserves acceptance of documented entries and ignores nested helpers', () => {
    expect(runGuard(undefined, { 'netlify/functions/lib/helper.ts': '' }).status).toBe(0);
  });
  it.each(['ts', 'mts', 'js'])(
    'rejects an undeclared top-level .%s function with repair instructions',
    extension => {
      const file = `netlify/functions/new-function.${extension}`;
      const result = runGuard(undefined, { [file]: '' });
      expect(result.status).toBe(1);
      expect(result.output).toContain(file);
      expect(result.output).toContain(CONFIG);
      expect(result.output).toContain('entries');
      expect(result.output).toContain('exempt');
    }
  );
  it('rejects an empty sensitive registry even when all functions are exempt', () => {
    const result = runGuard({
      entries: [],
      exempt: [{ functionFile: entry.functionFile, reason: 'public' }],
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('entries');
  });
  it.each([undefined, '', '   '])('rejects an exemption without a reason (%s)', reason => {
    const result = runGuard(
      { entries: [entry], exempt: [{ functionFile: 'netlify/functions/public.js', reason }] },
      { 'netlify/functions/public.js': '' }
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('reason');
    expect(result.output).toContain(CONFIG);
  });
  it('rejects a function listed in both entries and exempt', () => {
    const result = runGuard({
      entries: [entry],
      exempt: [{ functionFile: entry.functionFile, reason: 'public' }],
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain(entry.functionFile);
    expect(result.output).toContain('both');
  });
  it('accepts a justified exemption', () => {
    expect(
      runGuard(
        {
          entries: [entry],
          exempt: [
            { functionFile: 'netlify/functions/public.js', reason: 'Public version metadata' },
          ],
        },
        { 'netlify/functions/public.js': '' }
      ).status
    ).toBe(0);
  });
  it('rejects stale exemptions', () => {
    const result = runGuard({
      entries: [entry],
      exempt: [{ functionFile: 'netlify/functions/deleted.ts', reason: 'public' }],
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('netlify/functions/deleted.ts');
    expect(result.output).toContain(CONFIG);
  });
  it.each([
    { functionFile: 'netlify/functions/deleted.ts' },
    { testFiles: ['src/tests/missing.test.ts'] },
    { endpoint: 'undocumented' },
  ])('preserves rejection of invalid sensitive entries: %j', change => {
    expect(runGuard({ entries: [{ ...entry, ...change }], exempt: [] }).status).toBe(1);
  });
});

// E4d: this scheduled credential-bearing function must remain behavior-tested.
it('requires the telemetry retry behavior suite in the repository registry', () => {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const functionFile = 'netlify/functions/operational-telemetry-retry.ts';
  expect(config.exempt.map((item: { functionFile: string }) => item.functionFile)).not.toContain(
    functionFile
  );
  expect(config.entries).toContainEqual({
    id: 'operational_telemetry_retry',
    functionFile,
    endpoint: 'operational-telemetry-retry',
    testFiles: ['src/tests/netlify/operationalTelemetryRetry.test.ts'],
  });
});
