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
// The ten suites buildRequiredCiSuites declares in scripts/testExecutionManifestSupport.mjs.
const requiredSuites = [
  'unit-1',
  'unit-2',
  'unit-3',
  'unit-4',
  'storage',
  'critical-1',
  'critical-2',
  'critical-3',
  'cudyr',
  'flow',
];
const timerTest = 'src/tests/timer.test.ts';
const e2eSpec = 'e2e/login.spec.ts';

type ManifestCase = { file: string; status: string; attempts: number; flaky: boolean };
type ManifestOptions = {
  gitSha?: string;
  suites?: string[];
  issues?: string[];
  storageAttempt?: string;
};

const git = (root: string, args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** Runs a report script with the CI attempt this test chooses, never the one of the host CI. */
const runScript = (root: string, script: string, runAttempt?: string) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GITHUB_RUN_ATTEMPT;
  delete env.GITHUB_RUN_ID;
  if (runAttempt) env.GITHUB_RUN_ATTEMPT = runAttempt;
  const result = spawnSync(process.execPath, [path.resolve(script)], {
    cwd: root,
    encoding: 'utf8',
    env,
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

/** Unit cases go to unit-1 and browser cases to critical-1; the other suites ran clean. */
const writeManifest = (
  root: string,
  cases: ManifestCase[],
  {
    gitSha = git(root, ['rev-parse', 'HEAD']),
    suites = requiredSuites,
    issues = [],
    storageAttempt = '1',
  }: ManifestOptions = {}
) =>
  writeJson(root, 'reports/test-execution-manifest.json', {
    identity: { gitSha },
    requiredCiSuites: requiredSuites.map(suiteId => ({ suiteId })),
    observations: suites.map(suiteId => ({
      suiteId,
      mode: 'execution',
      accepted: true,
      ci: { runId: '1', runAttempt: suiteId === 'storage' ? storageAttempt : '1' },
      cases: cases.filter(testCase =>
        suiteId === 'unit-1'
          ? testCase.file.startsWith('src/')
          : suiteId === 'critical-1' && testCase.file.startsWith('e2e/')
      ),
      suiteErrors: [],
    })),
    issues,
  });

const systemConfidence = (root: string, runAttempt?: string) => {
  runScript(root, 'scripts/report-quality-metrics.mjs');
  runScript(root, 'scripts/report-system-confidence.mjs', runAttempt);
  const report = JSON.parse(
    fs.readFileSync(path.join(root, 'reports/system-confidence.json'), 'utf8')
  );
  const testGovernance = report.indicators.find(
    (indicator: { name: string }) => indicator.name === 'test_governance'
  );
  const markdown = fs.readFileSync(path.join(root, 'reports/system-confidence.md'), 'utf8');
  return { report, testGovernance, markdown };
};

const passed = (file: string): ManifestCase => ({
  file,
  status: 'passed',
  attempts: 1,
  flaky: false,
});

const expectUnmeasured = (testGovernance: { status: string; summary: string }, reason: string) =>
  expect(testGovernance).toMatchObject({
    status: 'degraded',
    summary: expect.stringContaining(`flakeRisk=unmeasured (${reason}`),
  });

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('measured flake risk in system confidence', () => {
  it('does not count a test file with setTimeout that passed on its first attempt', () => {
    const root = workspace();
    writeManifest(root, [passed(timerTest), passed(e2eSpec)]);

    const { report, testGovernance, markdown } = systemConfidence(root, '1');

    const qualityMetrics = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/quality-metrics.json'), 'utf8')
    );
    expect(qualityMetrics.tests.clockSignalFilePaths).toEqual([timerTest]);
    expect(testGovernance).toMatchObject({
      status: 'ok',
      summary: expect.stringContaining('flakeRisk=0,'),
    });
    expect(report.flakeRisk).toMatchObject({ measured: true, fileCount: 0, files: [] });
    expect(markdown).toContain(
      '- Not measured by this count (outside the manifest): preview smoke lanes, census startup performance, critical coverage shards, clinical-sync-release-gate,'
    );
  });

  it('counts a file whose test passed only after a retry', () => {
    const root = workspace();
    writeManifest(root, [passed(timerTest), { ...passed(e2eSpec), attempts: 2, flaky: true }]);

    const { report, testGovernance, markdown } = systemConfidence(root);

    expect(testGovernance).toMatchObject({
      status: 'degraded',
      summary: expect.stringContaining('flakeRisk=1,'),
    });
    expect(report.flakeRisk.files).toEqual([{ file: e2eSpec, failed: 0, retried: 1 }]);
    expect(markdown).toContain(`  - ${e2eSpec}: failed=0, retried=1`);
  });

  it('names a failed file but leaves the risk unmeasured while the manifest records issues', () => {
    const root = workspace();
    writeManifest(root, [{ ...passed(timerTest), status: 'failed' }], {
      issues: ['reports/execution/unit-1.evidence.json: Required evidence has test errors'],
    });

    const { report, testGovernance } = systemConfidence(root);

    expectUnmeasured(testGovernance, 'manifest records 1 issue(s)');
    expect(report.flakeRisk).toMatchObject({
      measured: false,
      fileCount: null,
      files: [{ file: timerTest, failed: 1, retried: 0 }],
    });
  });

  it('reports flake risk as unmeasured, not zero, when the manifest has 1 of its 10 suites', () => {
    const root = workspace();
    writeManifest(root, [passed(timerTest)], { suites: ['unit-1'] });

    expectUnmeasured(
      systemConfidence(root).testGovernance,
      'manifest lacks required suites: unit-2, unit-3, unit-4, storage, critical-1, critical-2, critical-3, cudyr, flow'
    );
  });

  it('reports flake risk as unmeasured, not zero, without execution evidence for this commit', () => {
    const root = workspace();

    const missing = systemConfidence(root);
    expectUnmeasured(missing.testGovernance, 'missing reports/test-execution-manifest.json');
    expect(missing.report.flakeRisk).toMatchObject({ measured: false, fileCount: null });
    expect(missing.report.missingPrerequisites).toContain('reports/test-execution-manifest.json');

    writeManifest(root, [passed(timerTest)], { gitSha: 'f'.repeat(40) });
    expectUnmeasured(systemConfidence(root).testGovernance, `manifest is for ${'f'.repeat(40)}`);
  });

  it('reports flake risk as unmeasured when a manifest job was re-run, because its failed attempt is gone', () => {
    const root = workspace();
    writeManifest(root, [passed(timerTest), passed(e2eSpec)], { storageAttempt: '2' });

    expectUnmeasured(systemConfidence(root).testGovernance, 'storage ran again in attempt 2;');
  });

  it('reports flake risk as unmeasured when the report job runs in attempt 2 over attempt-1 evidence', () => {
    // A preview smoke re-run repeats the report job but not test-execution-manifest (run 43663339140).
    const root = workspace();
    writeManifest(root, [passed(timerTest), passed(e2eSpec)]);

    const { report, testGovernance } = systemConfidence(root, '2');

    expectUnmeasured(testGovernance, 'this report was built in run attempt 2;');
    expect(report.flakeRisk).toMatchObject({ measured: false, fileCount: null });
  });
});
