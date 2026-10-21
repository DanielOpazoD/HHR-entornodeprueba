// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-manifest-cli-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'reports/\n');
  fs.copyFileSync(
    'scripts/report-test-execution-manifest.mjs',
    path.join(root, 'scripts/report-test-execution-manifest.mjs')
  );
  fs.symlinkSync(
    path.resolve('scripts/testExecutionManifestSupport.mjs'),
    path.join(root, 'scripts/testExecutionManifestSupport.mjs')
  );
  fs.writeFileSync(
    path.join(root, 'fake.mjs'),
    `import fs from 'node:fs'; fs.mkdirSync('reports',{recursive:true}); fs.writeFileSync('reports/raw.json',JSON.stringify({success:true,testResults:[{name:'fixture.test.ts',status:'passed',assertionResults:[{fullName:'body',status:'passed'}]}]}));`
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: root }
  );
  return root;
};
const capture = (root: string, args: string[]) =>
  spawnSync(process.execPath, ['scripts/report-test-execution-manifest.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

it('leaves wrapped command options after -- untouched', () => {
  const root = makeRoot();
  const result = capture(root, [
    '--capture',
    'vitest',
    '--suite',
    'focused',
    '--report',
    'reports/raw.json',
    '--output',
    'reports/evidence.json',
    '--',
    process.execPath,
    'fake.mjs',
    '--collection',
    '--output',
    'reports/child.json',
  ]);
  expect(result.status, result.stderr).toBe(0);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'reports/evidence.json'), 'utf8'));
  expect(evidence.mode).toBe('execution');
  expect(evidence.suiteId).toBe('focused');
  expect(evidence.command.slice(-3)).toEqual(['--collection', '--output', 'reports/child.json']);
  expect(fs.existsSync(path.join(root, 'reports/child.json'))).toBe(false);
});

it('requires its own output path even when the child command has --output', () => {
  const root = makeRoot();
  const result = capture(root, [
    '--capture',
    'vitest',
    '--report',
    'reports/raw.json',
    '--',
    process.execPath,
    'fake.mjs',
    '--output',
    'reports/child.json',
  ]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage:');
  expect(fs.existsSync(path.join(root, 'reports/child.json'))).toBe(false);
});

it('retains attributed diagnostics and the exit code when the runner produces no report', () => {
  const root = makeRoot();
  const result = capture(root, [
    '--capture',
    'vitest',
    '--report',
    'reports/raw.json',
    '--output',
    'reports/evidence.json',
    '--',
    process.execPath,
    '-e',
    'process.exit(3)',
  ]);
  expect(result.status).toBe(3);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'reports/evidence.json'), 'utf8'));
  expect(evidence.exitCode).toBe(3);
  expect(evidence.report).toBeNull();
  expect(evidence.captureError).toContain('Reporter artifact unavailable');
  expect(evidence.identity.gitSha).toMatch(/^[a-f0-9]{40}$/);
});
