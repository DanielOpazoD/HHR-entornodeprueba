// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildValidationClosePlan } from '../../../scripts/validationClosePlan.mjs';

const confidence = {
  profiles: { blocking: ['serverless', 'coverage', 'runtime'] },
  steps: [
    { id: 'serverless', command: 'npm run serverless' },
    { id: 'coverage', command: 'npm run coverage' },
    { id: 'runtime', command: 'npm run runtime' },
  ],
};
const scripts = {
  'ci:merge-gate':
    'npm run lint -- --max-warnings 0 && npm run coverage && npm run build && npm run preview',
  'test:release-confidence': 'node scripts/run-release-confidence-pack.mjs --profile blocking',
  serverless: 'npm run module-smoke && npm run build',
  lint: 'eslint .',
  coverage: 'node coverage.mjs',
  build: 'vite build',
  preview: 'PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 playwright test',
  'module-smoke': 'node smoke.mjs',
  runtime: 'node runtime.mjs',
};
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe('combined validation plan', () => {
  it('runs the union in dependency order and preserves args and environment-specific commands', () => {
    expect(buildValidationClosePlan({ scripts, confidence })).toEqual([
      { script: 'lint', args: ['--max-warnings', '0'] },
      ...['coverage', 'build', 'preview', 'module-smoke', 'runtime'].map(script => ({
        script,
        args: [],
      })),
    ]);
  });

  it('keeps npm lifecycle hooks with their original invocation', () => {
    const plan = buildValidationClosePlan({
      scripts: { ...scripts, preserverless: 'node before.mjs' },
      confidence,
    });
    expect(plan).toContainEqual({ script: 'serverless', args: [] });
    expect(plan).not.toContainEqual({ script: 'module-smoke', args: [] });
    const withReleaseHook = buildValidationClosePlan({
      scripts: { ...scripts, 'posttest:release-confidence': 'node after.mjs' },
      confidence,
    });
    expect(withReleaseHook.at(-1)).toEqual({ script: 'test:release-confidence', args: [] });
  });

  it('refuses missing or cyclic steps instead of running a partial gate', () => {
    expect(() =>
      buildValidationClosePlan({
        scripts,
        confidence: { ...confidence, profiles: { blocking: ['absent'] } },
      })
    ).toThrow('Invalid release-confidence step');
    expect(() =>
      buildValidationClosePlan({ scripts: { ...scripts, build: 'npm run serverless' }, confidence })
    ).toThrow('Cyclic npm script');
    expect(() =>
      buildValidationClosePlan({ scripts: { ...scripts, runtime: '' }, confidence })
    ).toThrow('Missing npm script');
  });

  it('refuses entrypoint drift instead of silently omitting new behavior', () => {
    expect(() =>
      buildValidationClosePlan({
        scripts: { ...scripts, 'test:release-confidence': 'node another-runner.mjs' },
        confidence,
      })
    ).toThrow('entrypoint changed');
  });
});

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-validation-close-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }));
  fs.writeFileSync(
    path.join(root, 'scripts/config/release-confidence-pack.json'),
    JSON.stringify(confidence)
  );
  fs.writeFileSync(path.join(root, '.gitignore'), 'calls.jsonl\nreports/\n');
  fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 1;');
  fs.writeFileSync(
    path.join(root, 'bin/npm'),
    `#!${process.execPath}
const fs = require('node:fs');
const script = process.argv[3];
fs.appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
if (script === process.env.FAIL_SCRIPT) process.exit(7);
if (script === process.env.SIGNAL_SCRIPT) process.kill(process.pid, 'SIGTERM');
if (script === process.env.MUTATE_SCRIPT) fs.appendFileSync('source.ts', '\\n// changed');
if (script === 'coverage') { fs.mkdirSync('reports', { recursive: true }); fs.writeFileSync('reports/critical-coverage.json', '{}'); }
`,
    { mode: 0o755 }
  );
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Synthetic Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    ],
  ])
    execFileSync('git', args, { cwd: root });
  return root;
};

const run = (root: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [path.resolve('scripts/run-validation-close.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      ...env,
      PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    },
  });
const calls = (root: string) =>
  fs
    .readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));

describe('combined validation execution', () => {
  it('executes each step once, tolerates generated reports and does not reuse another run', () => {
    const root = fixture();
    expect(run(root).status).toBe(0);
    expect(calls(root)).toEqual([
      ['run', 'lint', '--', '--max-warnings', '0'],
      ...['coverage', 'build', 'preview', 'module-smoke', 'runtime'].map(script => ['run', script]),
    ]);
    expect(run(root).status).toBe(0);
    expect(calls(root)).toHaveLength(12);
  });

  it.each([
    ['test failure', { FAIL_SCRIPT: 'coverage' }, 7],
    ['interruption', { SIGNAL_SCRIPT: 'coverage' }, 1],
    ['changed source', { MUTATE_SCRIPT: 'coverage' }, 1],
  ])('stops on %s without approving or continuing later steps', (_label, env, code) => {
    const root = fixture();
    const result = run(root, env);
    expect(result.status, result.stderr).toBe(code);
    expect(calls(root)).toHaveLength(2);
    expect(result.stdout).not.toContain('release-confidence passed');
  });

  it('rejects configuration changed while the execution plan is being read', () => {
    const root = fixture();
    const preload = path.join(root, 'change-config.cjs');
    fs.writeFileSync(
      preload,
      `
const fs = require('node:fs');
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  const content = read.call(this, file, ...args);
  if (String(file).endsWith('release-confidence-pack.json')) {
    fs.readFileSync = read;
    const pkg = JSON.parse(read('package.json', 'utf8'));
    pkg.scripts['ci:merge-gate'] += ' && npm run newly-required';
    pkg.scripts['newly-required'] = 'node another-check.mjs';
    fs.writeFileSync('package.json', JSON.stringify(pkg));
  }
  return content;
};
`
    );
    const result = run(root, { NODE_OPTIONS: `--require=${preload}` });
    expect(result.status, result.stderr).toBe(1);
    expect(fs.existsSync(path.join(root, 'calls.jsonl'))).toBe(false);
  });
});
