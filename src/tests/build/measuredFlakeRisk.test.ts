// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const qualityConfigs = [
  'release-confidence-matrix',
  'release-confidence-pack',
  'critical-smoke-pack',
  'flow-performance-budgets',
  'critical-coverage-thresholds',
  'technical-ownership-map',
];
const timerTest = 'src/tests/timer.test.ts';
const e2eSpec = 'e2e/login.spec.ts';

type ManifestCase = { file: string; status: string; attempts: number; flaky: boolean };

const git = (root: string, args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const runScript = (root: string, script: string) => {
  const result = spawnSync(process.execPath, [path.resolve(script)], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
};

const writeJson = (root: string, relative: string, value: unknown) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
};

/** A committed workspace whose only test waits with a real setTimeout. */
const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-flake-risk-'));
  roots.push(root);
  writeJson(root, 'package.json', { scripts: {} });
  for (const name of qualityConfigs) writeJson(root, `scripts/config/${name}.json`, {});
  fs.mkdirSync(path.join(root, 'src/tests'), { recursive: true });
  fs.writeFileSync(
    path.join(root, timerTest),
    "it('waits', async () => { await new Promise(resolve => setTimeout(resolve, 1)); });\n"
  );
  fs.writeFileSync(path.join(root, '.gitignore'), 'reports/\n');
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'x',
  ]);
  return root;
};

const writeManifest = (
  root: string,
  cases: ManifestCase[],
  { gitSha = git(root, ['rev-parse', 'HEAD']), storageAttempt = '1' } = {}
) =>
  writeJson(root, 'reports/test-execution-manifest.json', {
    identity: { gitSha },
    observations: [
      {
        suiteId: 'storage',
        mode: 'execution',
        ci: { runId: '1', runAttempt: storageAttempt, job: 'rules-emulator' },
        cases: [],
        suiteErrors: [],
      },
      {
        suiteId: 'unit-1',
        mode: 'execution',
        cases: cases.filter(testCase => testCase.file.startsWith('src/')),
        suiteErrors: [],
      },
      {
        suiteId: 'critical-1',
        mode: 'execution',
        cases: cases.filter(testCase => testCase.file.startsWith('e2e/')),
        suiteErrors: [],
      },
    ],
  });

const systemConfidence = (root: string) => {
  runScript(root, 'scripts/report-quality-metrics.mjs');
  runScript(root, 'scripts/report-system-confidence.mjs');
  const report = JSON.parse(
    fs.readFileSync(path.join(root, 'reports/system-confidence.json'), 'utf8')
  );
  const testGovernance = report.indicators.find(
    (indicator: { name: string }) => indicator.name === 'test_governance'
  );
  return { report, testGovernance };
};

const passed = (file: string): ManifestCase => ({
  file,
  status: 'passed',
  attempts: 1,
  flaky: false,
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('measured flake risk in system confidence', () => {
  it('does not count a test file with setTimeout that passed on its first attempt', () => {
    const root = workspace();
    writeManifest(root, [passed(timerTest), passed(e2eSpec)]);

    const { report, testGovernance } = systemConfidence(root);

    const qualityMetrics = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/quality-metrics.json'), 'utf8')
    );
    expect(qualityMetrics.tests.clockSignalFilePaths).toEqual([timerTest]);
    expect(testGovernance).toMatchObject({
      status: 'ok',
      summary: expect.stringContaining('flakeRisk=0,'),
    });
    expect(report.flakeRisk).toMatchObject({ measured: true, fileCount: 0, files: [] });
  });

  it('counts a file whose test passed only after a retry, and a file that failed', () => {
    const root = workspace();
    writeManifest(root, [
      { file: timerTest, status: 'failed', attempts: 1, flaky: false },
      { file: e2eSpec, status: 'passed', attempts: 2, flaky: true },
    ]);

    const { report, testGovernance } = systemConfidence(root);

    expect(testGovernance).toMatchObject({
      status: 'degraded',
      summary: expect.stringContaining('flakeRisk=2,'),
    });
    expect(report.flakeRisk.files).toEqual([
      { file: e2eSpec, failed: 0, retried: 1 },
      { file: timerTest, failed: 1, retried: 0 },
    ]);
    expect(fs.readFileSync(path.join(root, 'reports/system-confidence.md'), 'utf8')).toContain(
      `  - ${e2eSpec}: failed=0, retried=1`
    );
  });

  it('reports flake risk as unmeasured, not zero, without execution evidence for this commit', () => {
    const root = workspace();

    const missing = systemConfidence(root);
    expect(missing.testGovernance).toMatchObject({
      status: 'degraded',
      summary: expect.stringContaining(
        'flakeRisk=unmeasured (missing reports/test-execution-manifest.json)'
      ),
    });
    expect(missing.report.flakeRisk).toMatchObject({ measured: false, fileCount: null });
    expect(missing.report.missingPrerequisites).toContain('reports/test-execution-manifest.json');

    writeManifest(root, [passed(timerTest)], { gitSha: 'f'.repeat(40) });
    expect(systemConfidence(root).testGovernance).toMatchObject({
      status: 'degraded',
      summary: expect.stringContaining(`flakeRisk=unmeasured (manifest is for ${'f'.repeat(40)}`),
    });
  });

  it('reports flake risk as unmeasured when a job was re-run, because its failed attempt is gone', () => {
    const root = workspace();
    writeManifest(root, [passed(timerTest), passed(e2eSpec)], { storageAttempt: '2' });

    const { report, testGovernance } = systemConfidence(root);

    expect(testGovernance).toMatchObject({
      status: 'degraded',
      summary: expect.stringContaining('flakeRisk=unmeasured (storage ran again in attempt 2;'),
    });
    expect(report.flakeRisk).toMatchObject({ measured: false, fileCount: null });
  });
});
