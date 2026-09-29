// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const runner = path.resolve('scripts/run-unit-shard.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('unit shard process outcome', () => {
  it.each([
    ['success', 'process.exit(0)', 0],
    ['failed tests', 'process.exit(7)', 7],
    ['terminated child', "process.kill(process.pid, 'SIGTERM')", 1],
    ['missing executable', null, 1],
  ])('reports %s without approving an incomplete run', (_label, childSource, expected) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-shard-outcome-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src/tests'), { recursive: true });
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(
      path.join(root, 'scripts/config/unit-shard-balance.json'),
      JSON.stringify({ shardCount: 4, tolerancePercent: 25 })
    );
    for (let index = 0; index < 4; index += 1) {
      fs.writeFileSync(path.join(root, `src/tests/example-${index}.test.ts`), '// fixture');
    }
    if (childSource !== null) {
      fs.writeFileSync(path.join(root, 'bin/npx'), `#!${process.execPath}\n${childSource}\n`, {
        mode: 0o755,
      });
    }
    const result = spawnSync(process.execPath, [runner, '1/4'], {
      cwd: root,
      env: { ...process.env, PATH: path.join(root, 'bin') },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout, result.stderr).toContain('[unit-shard] Running shard 1/4');
    expect(result.status, result.stderr).toBe(expected);
    if (expected === 1) expect(result.stderr).toContain('[unit-shard] Runner did not complete:');
  });
});
