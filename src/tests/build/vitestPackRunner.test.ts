// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const runners = ['run-critical-smoke-pack.mjs', 'run-unit-critical.mjs'];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const fixture = (child = 'process.exit(0)') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-vitest-pack-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  const files = ['src/tests/first.test.ts', 'src/tests/second.test.tsx'];
  files.forEach(file => fs.writeFileSync(path.join(root, file), '// fixture'));
  fs.writeFileSync(
    path.join(root, 'scripts/config/critical-smoke-pack.json'),
    JSON.stringify({ scenarios: [...files, files[0]].map(file => ({ id: file, file })) })
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        'test:risk:auth': `vitest run ${files[0]}`,
        'test:risk:admin-health': `vitest run ${files[1]}`,
        'test:risk:platform': `vitest run ${files[0]}`,
      },
    })
  );
  fs.writeFileSync(
    path.join(root, 'bin/npx'),
    `#!${process.execPath}\nrequire('node:fs').appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');\n${child}\n`,
    { mode: 0o755 }
  );
  return { root, files };
};

const run = (name: string, root: string, workers = '2') =>
  spawnSync(process.execPath, [path.resolve('scripts', name)], {
    cwd: root,
    env: { ...process.env, PATH: path.join(root, 'bin'), VITEST_MAX_WORKERS: workers },
    encoding: 'utf8',
    timeout: 10000,
  });

describe.each(runners)('%s', runner => {
  it('runs every selected file once in one isolated, bounded invocation', () => {
    const { root, files } = fixture();
    const result = run(runner, root);
    expect(result.status, result.stderr).toBe(0);
    const calls = fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0])).toEqual([
      'vitest',
      'run',
      ...files,
      '--isolate',
      '--maxWorkers',
      '2',
    ]);
  });

  it.each([
    ['failed tests', 'process.exit(7)', 7],
    ['terminated runner', "process.kill(process.pid, 'SIGTERM')", 1],
  ])('propagates %s', (_label, child, code) => {
    const { root } = fixture(child);
    expect(run(runner, root).status).toBe(code);
  });

  it('rejects a missing selected file before running an incomplete pack', () => {
    const { root, files } = fixture();
    fs.rmSync(path.join(root, files[1]));
    expect(run(runner, root).status).toBe(1);
    expect(fs.existsSync(path.join(root, 'calls.jsonl'))).toBe(false);
  });

  it('rejects invalid worker limits', () => {
    const { root } = fixture();
    expect(run(runner, root, '0').status).toBe(1);
    expect(fs.existsSync(path.join(root, 'calls.jsonl'))).toBe(false);
  });

  it('fails when the executable cannot start', () => {
    const { root } = fixture();
    fs.rmSync(path.join(root, 'bin/npx'));
    const result = run(runner, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Runner did not complete');
  });
});
