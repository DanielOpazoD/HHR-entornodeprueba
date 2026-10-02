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

const runMetrics = (root: string, inputPath: string) => {
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
        E2E_BASELINE_METRICS_PATH: '',
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

  it('compares against earlier history before adding the current execution once', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical-playwright-report.json');
    writeReport(criticalPath, [['passed'], ['passed']]);
    fs.mkdirSync(path.join(root, 'history'));
    fs.writeFileSync(
      path.join(root, 'history', 'previous.json'),
      JSON.stringify({ reportFound: true, durationMs: 100, flaky: 0, retriesUsed: 0 })
    );

    const { result, metrics, history, stepSummary } = runMetrics(root, criticalPath);

    expect(result.status).toBe(0);
    expect(metrics.baseline).toMatchObject({ source: 'history(1)', durationMs: 100 });
    expect(metrics.durationRegressionPct).toBe(100);
    expect(history).toHaveLength(2);
    expect(stepSummary.match(/# E2E Operational Metrics/g)).toHaveLength(1);
  });
});
