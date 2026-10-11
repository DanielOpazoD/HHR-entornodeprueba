// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const runner = path.resolve('scripts/run-critical-coverage.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const runFixture = (childSource: string, targets = ['src/tests/example.test.ts']) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-coverage-runner-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'scripts/config/critical-coverage-thresholds.json'),
    JSON.stringify({ zones: targets.length ? { 'src/example': { coverageTests: targets } } : {} })
  );
  fs.writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), childSource);
  return spawnSync(process.execPath, [runner], {
    cwd: root,
    env: { ...process.env, VITEST_MAX_WORKERS: '2' },
    encoding: 'utf8',
    timeout: 10000,
  });
};

describe('critical coverage process outcome', () => {
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
