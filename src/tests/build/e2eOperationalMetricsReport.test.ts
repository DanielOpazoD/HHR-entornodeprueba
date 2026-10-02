// @vitest-environment node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tmpRoots: string[] = [];

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-operational-metrics-'));
  tmpRoots.push(root);
  return root;
};

const writeReport = (
  reportPath: string,
  tests: Array<Array<'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped'>>
) => {
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      stats: {
        expected: tests.filter(statuses => statuses.length === 1 && statuses[0] === 'passed')
          .length,
        unexpected: tests.filter(statuses =>
          ['failed', 'timedOut', 'interrupted'].includes(statuses.at(-1)!)
        ).length,
        flaky: tests.filter(statuses => statuses.length > 1 && statuses.at(-1) === 'passed').length,
        skipped: tests.filter(statuses => statuses.at(-1) === 'skipped').length,
      },
      suites: [
        {
          specs: tests.map((statuses, index) => ({
            title: `test-${index + 1}`,
            tests: [
              {
                projectName: 'chromium',
                results: statuses.map((status, attempt) => ({
                  status,
                  duration: 100 + attempt,
                })),
              },
            ],
          })),
        },
      ],
    }),
    'utf8'
  );
};

const runMetrics = (root: string, inputPath: string, baselinePath = '') => {
  const outputPath = path.join(root, 'critical-operational-metrics.json');
  const summaryPath = path.join(root, 'critical-operational-summary.md');
  const historyPath = path.join(root, 'history');
  const stepSummaryPath = path.join(root, 'step-summary.md');
  const result = spawnSync(
    process.execPath,
    [
      'scripts/report-e2e-operational-metrics.mjs',
      inputPath,
      outputPath,
      summaryPath,
      historyPath,
      '--enforce',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: stepSummaryPath,
        E2E_BASELINE_METRICS_PATH: baselinePath,
      },
    }
  );
  return {
    result,
    metrics: JSON.parse(fs.readFileSync(outputPath, 'utf8')) as Record<string, unknown>,
    history: fs.readdirSync(historyPath),
    summary: fs.readFileSync(summaryPath, 'utf8'),
    stepSummary: fs.readFileSync(stepSummaryPath, 'utf8'),
  };
};

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('E2E operational metrics report', () => {
  it('fails on critical flaky evidence even when the separate performance report is clean', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical-playwright-report.json');
    const performancePath = path.join(root, 'flow-performance-playwright-report.json');
    writeReport(criticalPath, [['passed'], ['failed', 'passed']]);
    writeReport(performancePath, [['passed']]);
    const performanceBefore = fs.readFileSync(performancePath, 'utf8');

    const { result, metrics, history, summary, stepSummary } = runMetrics(root, criticalPath);

    expect(result.status).toBe(1);
    expect(metrics.source).toBe(criticalPath);
    expect(metrics.totalTests).toBe(2);
    expect(metrics.flaky).toBe(1);
    expect(metrics.status).toBe('fail');
    expect(metrics.baseline).toBeNull();
    expect(history).toHaveLength(1);
    expect(summary).toContain('- Status: FAIL');
    expect(stepSummary.match(/# E2E Operational Metrics/g)).toHaveLength(1);
    expect(fs.readFileSync(performancePath, 'utf8')).toBe(performanceBefore);
  });

  it('passes when the complete critical report is clean', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical-playwright-report.json');
    writeReport(criticalPath, [['passed'], ['passed']]);

    const { result, metrics, history, summary, stepSummary } = runMetrics(root, criticalPath);

    expect(result.status).toBe(0);
    expect(metrics.totalTests).toBe(2);
    expect(metrics.flaky).toBe(0);
    expect(metrics.status).toBe('pass');
    expect(metrics.baseline).toBeNull();
    expect(history).toHaveLength(1);
    expect(summary).toContain('- Status: PASS');
    expect(stepSummary.match(/# E2E Operational Metrics/g)).toHaveLength(1);
  });

  it('attributes real Playwright test-level projects, retries and durations through nested suites', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(input, [['passed'], ['failed', 'passed'], ['passed'], ['passed']]);
    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    const specs = report.suites[0].specs;
    specs[1].tests[0].projectName = 'firefox';
    delete specs[2].tests[0].projectName;
    specs[2].tests[0].projectId = 'webkit';
    delete specs[3].tests[0].projectName;
    // Results carry no project metadata in Playwright's real JSON reporter.
    report.suites = [{ suites: [{ specs }] }];
    fs.writeFileSync(input, JSON.stringify(report));
    const { result, metrics, summary } = runMetrics(root, input);
    expect(result.status).toBe(1);
    expect(metrics.projects).toEqual({
      chromium: { tests: 1, flaky: 0, retriesUsed: 0, durationMs: 100 },
      firefox: { tests: 1, flaky: 1, retriesUsed: 1, durationMs: 201 },
      webkit: { tests: 1, flaky: 0, retriesUsed: 0, durationMs: 100 },
      unknown: { tests: 1, flaky: 0, retriesUsed: 0, durationMs: 100 },
    });
    expect(summary).toContain('| firefox | 1 | 1 | 1 | 0.2 |');
    expect(metrics.totalTests).toBe(4);
    expect(metrics.durationMs).toBe(501);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'keeps a valid project named %s as an own metrics bucket',
    projectName => {
      const root = makeRoot();
      const input = path.join(root, 'report.json');
      writeReport(input, [['passed']]);
      const report = JSON.parse(fs.readFileSync(input, 'utf8'));
      report.suites[0].specs[0].tests[0].projectName = projectName;
      fs.writeFileSync(input, JSON.stringify(report));
      const { result, metrics } = runMetrics(root, input);
      expect(result.status).toBe(0);
      expect(Object.entries(metrics.projects as object)).toEqual([
        [projectName, { tests: 1, flaky: 0, retriesUsed: 0, durationMs: 100 }],
      ]);
    }
  );

  it('separates wall time from attempt sums and ranks bounded test and file costs', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(
      input,
      Array.from({ length: 12 }, () => ['passed'])
    );
    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    report.stats.duration = 800;
    for (const [index, spec] of report.suites[0].specs.entries()) {
      spec.file = index < 6 ? 'a.spec.ts' : 'b.spec.ts';
      spec.line = index + 1;
      spec.tests[0].results[0].duration = index * 100;
    }
    report.suites[0].specs[11].title = 'slow | test\nlabel';
    fs.writeFileSync(input, JSON.stringify(report));
    const { result, metrics, summary } = runMetrics(root, input);
    expect(result.status).toBe(0);
    expect(metrics.durationMs).toBe(6600);
    expect(metrics.wallDurationMs).toBe(800);
    expect(metrics.slowestTests).toHaveLength(10);
    expect((metrics.slowestTests as object[])[0]).toMatchObject({
      file: 'b.spec.ts',
      line: 12,
      project: 'chromium',
      attempts: 1,
      durationMs: 1100,
    });
    expect(metrics.files).toEqual({
      'a.spec.ts': { tests: 6, attempts: 6, durationMs: 1500 },
      'b.spec.ts': { tests: 6, attempts: 6, durationMs: 5100 },
    });
    expect(summary).toContain('slow \\| test label');
    expect(summary).toContain('Playwright wall duration: 0.8 s');
    expect(summary).toContain('sum of test attempts): 6.6 s');
  });

  it('does not invent a wall duration when the reporter did not provide one', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(input, [['passed']]);
    const { metrics, summary } = runMetrics(root, input);
    expect(metrics.wallDurationMs).toBeNull();
    expect(summary).toContain('Playwright wall duration: unavailable');
  });

  it.each(['missing', 'invalid-json', 'null', 'empty', 'empty-suites', 'global-error'])(
    'fails enforcement but preserves diagnostic artifacts for %s evidence',
    kind => {
      const root = makeRoot();
      const input = path.join(root, 'report.json');
      if (kind === 'invalid-json') fs.writeFileSync(input, '{');
      else if (kind === 'null') fs.writeFileSync(input, 'null');
      else if (kind === 'empty') fs.writeFileSync(input, '{}');
      else if (kind === 'empty-suites') writeReport(input, []);
      else if (kind === 'global-error') {
        writeReport(input, [['passed']]);
        const report = JSON.parse(fs.readFileSync(input, 'utf8'));
        report.errors = [{ message: 'Synthetic worker crash' }];
        fs.writeFileSync(input, JSON.stringify(report));
      }
      const { result, metrics, summary, stepSummary } = runMetrics(root, input);
      expect(result.status).toBe(1);
      expect(metrics.status).toBe('fail');
      expect(metrics.violations).not.toHaveLength(0);
      expect(summary).toContain('- Status: FAIL');
      expect(stepSummary).toContain('- Status: FAIL');
    }
  );

  it.each(['failed', 'timedOut', 'interrupted'] as const)(
    'fails on a terminal %s test even if stats claim a pass',
    status => {
      const root = makeRoot();
      const input = path.join(root, 'report.json');
      writeReport(input, [[status]]);
      const report = JSON.parse(fs.readFileSync(input, 'utf8'));
      report.stats = { expected: 1, unexpected: 0, flaky: 0 };
      fs.writeFileSync(input, JSON.stringify(report));
      const { result, metrics } = runMetrics(root, input);
      expect(result.status).toBe(1);
      expect(metrics.status).toBe('fail');
    }
  );

  it('ignores failed, invalid, legacy and different-cohort history before averaging', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(input, [['passed']]);
    const earlier = runMetrics(root, input);
    const rejected = [
      { status: 'fail' },
      { failed: 1 },
      { timedOut: 1 },
      { interrupted: 1 },
      { flaky: 1 },
      { passed: 0 },
      { durationMs: null },
      { durationMs: -1 },
      { totalTests: 2 },
      { suiteFingerprint: 'other-suite' },
      { suiteFingerprint: undefined },
      { reportFound: false },
    ];
    for (const [index, override] of rejected.entries()) {
      fs.writeFileSync(
        path.join(root, 'history', `invalid-${index}.json`),
        JSON.stringify({ ...earlier.metrics, durationMs: 50000, ...override })
      );
    }
    const { result, metrics } = runMetrics(root, input);
    expect(result.status).toBe(0);
    expect(metrics.baseline).toMatchObject({ source: 'history(1)', durationMs: 100 });
    expect(metrics.durationRegressionPct).toBe(0);
  });

  it('rejects an explicit different-project baseline and falls back to comparable history', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(input, [['passed']]);
    const earlier = runMetrics(root, input);
    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    report.suites[0].specs[0].tests[0].projectName = 'firefox';
    fs.writeFileSync(input, JSON.stringify(report));
    const explicit = path.join(root, 'baseline.json');
    fs.writeFileSync(explicit, JSON.stringify(earlier.metrics));
    const { metrics } = runMetrics(root, input, explicit);
    expect(metrics.baseline).toBeNull();
    expect(metrics.status).toBe('warn');
    expect(metrics.warnings).toEqual([expect.stringContaining('different test cohort')]);
  });

  it.each([null, { results: {} }])(
    'preserves failure artifacts for a structurally invalid test entry %j',
    testEntry => {
      const root = makeRoot();
      const input = path.join(root, 'report.json');
      fs.writeFileSync(input, JSON.stringify({ suites: [{ specs: [{ tests: [testEntry] }] }] }));
      const { result, metrics, summary } = runMetrics(root, input);
      expect(result.status).toBe(1);
      expect(metrics.status).toBe('fail');
      expect(summary).toContain('- Status: FAIL');
    }
  );

  it('does not compare runs that skip different tests even with the same totals', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(input, [['passed'], ['skipped']]);
    const earlier = runMetrics(root, input);
    expect(earlier.metrics.status).toBe('pass');
    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    report.suites[0].specs[0].tests[0].results[0].status = 'skipped';
    report.suites[0].specs[1].tests[0].results[0].status = 'passed';
    fs.writeFileSync(input, JSON.stringify(report));
    const { result, metrics } = runMetrics(root, input);
    expect(result.status).toBe(0);
    expect(metrics.totalTests).toBe(earlier.metrics.totalTests);
    expect(metrics.skipped).toBe(earlier.metrics.skipped);
    expect(metrics.suiteFingerprint).not.toBe(earlier.metrics.suiteFingerprint);
    expect(metrics.baseline).toBeNull();
  });

  it('accepts a complete explicit baseline for the same cohort regardless of report ordering', () => {
    const root = makeRoot();
    const input = path.join(root, 'report.json');
    writeReport(input, [['passed'], ['passed']]);
    const earlier = runMetrics(root, input);
    const explicit = path.join(root, 'baseline.json');
    fs.writeFileSync(explicit, JSON.stringify({ ...earlier.metrics, durationMs: 200 }));
    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    report.suites[0].specs.reverse();
    fs.writeFileSync(input, JSON.stringify(report));
    const { result, metrics } = runMetrics(root, input, explicit);
    expect(result.status).toBe(0);
    expect(metrics.baseline).toMatchObject({ source: explicit, durationMs: 200 });
    expect(metrics.suiteFingerprint).toBe(earlier.metrics.suiteFingerprint);
  });

  it('compares against earlier history before adding the current execution once', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical-playwright-report.json');
    writeReport(criticalPath, [['passed'], ['passed']]);
    const earlier = runMetrics(root, criticalPath);
    fs.writeFileSync(
      path.join(root, 'history', earlier.history[0]),
      JSON.stringify({ ...earlier.metrics, durationMs: 100 })
    );
    fs.writeFileSync(path.join(root, 'step-summary.md'), '');

    const { result, metrics, history, stepSummary } = runMetrics(root, criticalPath);

    expect(result.status).toBe(0);
    expect(metrics.baseline).toMatchObject({ source: 'history(1)', durationMs: 100 });
    expect(metrics.durationRegressionPct).toBe(100);
    expect(history).toHaveLength(2);
    expect(stepSummary.match(/# E2E Operational Metrics/g)).toHaveLength(1);
  });
});
