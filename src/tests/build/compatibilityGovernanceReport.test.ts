import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scriptUrl = pathToFileURL(path.resolve('scripts/report-compatibility-governance.mjs')).href;
const tempRoots: string[] = [];

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compatibility-report-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/legacy.ts'), 'export {};\n');
  const config = {
    policyVersion: 'test-v1',
    entries: [
      {
        path: 'src/legacy.ts',
        owner: 'test',
        kind: 'migration_shim',
        remainingConsumers: 'one adapter',
        reason: 'transition',
        retirementCriteria: 'no consumers',
        target: 'next release',
      },
    ],
  };
  const configPath = path.join(root, 'scripts/config/compatibility-governance.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { root, config, configPath };
};

const runReport = (root: string, time: string) => {
  // Exercise the real CLI with a controlled clock, without sleeping or touching repository reports.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `Date.prototype.toISOString = () => ${JSON.stringify(time)}; await import(${JSON.stringify(scriptUrl)});`,
    ],
    { cwd: root, encoding: 'utf8' }
  );
  return {
    json: fs.readFileSync(path.join(root, 'reports/compatibility-governance.json'), 'utf8'),
    markdown: fs.readFileSync(path.join(root, 'reports/compatibility-governance.md'), 'utf8'),
  };
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('compatibility governance snapshot', () => {
  it('writes identical JSON and Markdown for identical inputs across different clocks', () => {
    const { root } = createFixture();
    const first = runReport(root, '2026-01-01T00:00:00.000Z');
    const second = runReport(root, '2026-09-05T00:00:00.000Z');

    expect(second).toEqual(first);
    expect(JSON.parse(second.json).generatedAt).toBe('stable:compatibility-governance');
    expect(second.markdown).toContain('- Generated: stable:compatibility-governance');
  });

  it('still reflects changed policy and missing files instead of reusing an old snapshot', () => {
    const { root, config, configPath } = createFixture();
    const first = runReport(root, '2026-01-01T00:00:00.000Z');
    expect(JSON.parse(first.json).missingEntries).toEqual([]);
    expect(JSON.parse(first.json).entries[0].exists).toBe(true);

    fs.rmSync(path.join(root, 'src/legacy.ts'));
    config.policyVersion = 'test-v2';
    config.entries[0].owner = 'new-owner';
    fs.writeFileSync(configPath, JSON.stringify(config));
    const second = runReport(root, '2026-01-01T00:00:00.000Z');
    const report = JSON.parse(second.json);

    expect(report).toMatchObject({
      policyVersion: 'test-v2',
      trackedEntries: 1,
      missingEntries: ['src/legacy.ts'],
    });
    expect(report.entries[0]).toMatchObject({ owner: 'new-owner', exists: false });
    expect(report.entries[0].riskIfRetained).toContain('deuda transicional');
    expect(second.markdown).toContain('- Policy version: test-v2');
    expect(second.markdown).toContain('| `src/legacy.ts` | new-owner | migration_shim | no |');
    expect(second).not.toEqual(first);
  });
});
