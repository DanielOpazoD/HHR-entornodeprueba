// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

const runBudget = (size: number, category: string, severity = 'error') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-message-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
  const limit = 635136;
  const config = {
    entryMaxBytes: category === 'entry' ? limit : 2000000,
    chunkMaxBytes: category === 'chunk' ? limit : 2000000,
    precacheMaxBytes: category === 'precache' ? limit : 2000000,
    forbiddenAssetPatterns: [category === 'forbidden' ? '^assets/entry' : 'never-match'],
    startupChunkBudgets:
      category === 'startup'
        ? [{ label: 'shell', source: 'entry', maxBytes: limit, severity }]
        : [],
    chunkPatternBudgets:
      category === 'chunkPattern' ? [{ pattern: '^entry', maxBytes: limit }] : [],
    assetPatternBudgets:
      category === 'assetPattern' ? [{ pattern: '^assets/entry', maxBytes: limit }] : [],
  };
  fs.writeFileSync(path.join(root, 'scripts/config/bundle-budget.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<script src="/assets/entry.js"></script>');
  fs.writeFileSync(path.join(root, 'dist/assets/entry.js'), Buffer.alloc(size));
  fs.writeFileSync(path.join(root, 'dist/service-worker.js'), '{"url":"assets/entry.js"}');
  return spawnSync(process.execPath, [path.resolve('scripts/check-bundle-budget.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
};

const categories = [
  ['entry', 'entryMaxBytes'],
  ['chunk', 'chunkMaxBytes'],
  ['precache', 'precacheMaxBytes'],
  ['startup', 'startupChunkBudgets[0].maxBytes'],
  ['chunkPattern', 'chunkPatternBudgets[0].maxBytes'],
  ['assetPattern', 'assetPatternBudgets[0].maxBytes'],
];
describe('bundle budget messages', () => {
  it.each(categories)('reports exact small and large excess for %s', (category, key) => {
    for (const excess of [1, 100000]) {
      const result = runBudget(635136 + excess, category);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${635136 + excess} B`);
      expect(result.stderr).toContain('635136 B');
      expect(result.stderr).toContain(`+${excess} B`);
      const line = result.stderr.split('\n').find(line => line.includes(`+${excess} B`));
      expect(line).toContain(category === 'precache' ? 'service-worker.js' : 'entry.js');
      expect(line).toContain(`${635136 + excess} B`);
      expect(line).toContain('635136 B');
      expect(line).toContain(`scripts/config/bundle-budget.json.${key}`);
      expect(result.stderr).toContain('Do not raise limits without the responsible owner');
    }
  });

  it('preserves the success output and exit code below the limits', () => {
    const result = runBudget(1024, 'entry');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      '[bundle-budget] OK\n' +
        '[bundle-budget] Entry budget: 620.3 KB | Chunk budget: 1953.1 KB\n' +
        '[bundle-budget] Precache payload: 1.0 KB (1 files, limit 1953.1 KB)\n' +
        '[bundle-budget] Pre-login static JS: 1.0 KB (1 files)\n' +
        '[bundle-budget] Entry asset: entry.js (1.0 KB)\n' +
        '[bundle-budget] Largest chunk: entry.js (1.0 KB)\n'
    );
  });

  it('reports transitive pre-login static JS bytes while excluding dynamic imports', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-prelogin-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
    const config = {
      entryMaxBytes: 2000000,
      chunkMaxBytes: 2000000,
      precacheMaxBytes: 2000000,
      forbiddenAssetPatterns: ['never-match'],
      startupChunkBudgets: [],
      chunkPatternBudgets: [],
      assetPatternBudgets: [],
    };
    fs.writeFileSync(path.join(root, 'scripts/config/bundle-budget.json'), JSON.stringify(config));
    fs.writeFileSync(
      path.join(root, 'dist/index.html'),
      '<script type="module" src="/assets/entry.js"></script>'
    );
    const padTo = (content: string, totalBytes: number) =>
      content + ' '.repeat(Math.max(0, totalBytes - Buffer.byteLength(content)));
    fs.writeFileSync(
      path.join(root, 'dist/assets/entry.js'),
      padTo('import{a}from"./boot.js";import("./lazy.js");', 1024)
    );
    fs.writeFileSync(
      path.join(root, 'dist/assets/boot.js'),
      padTo('import"./vendor.js";export const a=1;', 2048)
    );
    fs.writeFileSync(path.join(root, 'dist/assets/vendor.js'), padTo('console.log(1);', 4096));
    fs.writeFileSync(path.join(root, 'dist/assets/lazy.js'), padTo('export const b=2;', 8192));
    fs.writeFileSync(path.join(root, 'dist/service-worker.js'), '{"url":"assets/entry.js"}');

    const result = spawnSync(process.execPath, [path.resolve('scripts/check-bundle-budget.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[bundle-budget] Pre-login static JS: 7.0 KB (3 files)');
  });

  it.each(categories)('accepts equality for %s', category => {
    const result = runBudget(635136, category);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('near');
    expect(result.stderr).not.toContain('+0 B');
  });

  it.each(categories)('accepts one byte below the limit for %s', category => {
    expect(runBudget(635135, category).status).toBe(0);
  });

  it('reports a one-byte forbidden asset against its implicit zero-byte allowance', () => {
    const result = runBudget(1, 'forbidden');
    expect(result.status).toBe(1);
    const line = result.stderr.split('\n').find(line => line.includes('Forbidden'));
    expect(line).toContain('assets/entry.js');
    expect(line).toContain('actual 1 B, limit 0 B, excess +1 B');
    expect(line).toContain('scripts/config/bundle-budget.json.forbiddenAssetPatterns[0]');
  });

  it('still rejects an empty forbidden asset because the policy forbids its presence', () => {
    expect(runBudget(0, 'forbidden').status).toBe(1);
  });

  it('keeps startup warn severity successful while explaining the excess', () => {
    const result = runBudget(635137, 'startup', 'warn');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('+1 B');
  });
});
