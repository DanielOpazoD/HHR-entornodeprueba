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
    forbiddenAssetPatterns: ['never-match'],
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

const categories = ['entry', 'chunk', 'precache', 'startup', 'chunkPattern', 'assetPattern'];
describe('bundle budget messages', () => {
  it.each(categories)('reports exact small and large excess for %s', category => {
    for (const excess of [1, 100000]) {
      const result = runBudget(635136 + excess, category);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${635136 + excess} B`);
      expect(result.stderr).toContain('635136 B');
      expect(result.stderr).toContain(`+${excess} B`);
      expect(result.stderr).toContain('scripts/config/bundle-budget.json');
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
        '[bundle-budget] Entry asset: entry.js (1.0 KB)\n' +
        '[bundle-budget] Largest chunk: entry.js (1.0 KB)\n'
    );
  });

  it.each(categories)('accepts equality for %s', category => {
    const result = runBudget(635136, category);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('near');
    expect(result.stderr).not.toContain('+0 B');
  });

  it('keeps startup warn severity successful while explaining the excess', () => {
    const result = runBudget(635137, 'startup', 'warn');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('+1 B');
  });
});
