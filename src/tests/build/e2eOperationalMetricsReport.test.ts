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
      suites: [
        {
          specs: tests.map((statuses, index) => ({
            title: `test-${index + 1}`,
            tests: [
              {
                results: statuses.map((status, attempt) => ({
                  status,
                  duration: 100 + attempt,
                  projectName: 'chromium',
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
    { cwd: process.cwd(), encoding: 'utf8' }
  );
  return {
    result,
    metrics: JSON.parse(fs.readFileSync(outputPath, 'utf8')) as Record<string, unknown>,
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

    const { result, metrics } = runMetrics(root, criticalPath);

    expect(result.status).toBe(1);
    expect(metrics.source).toBe(criticalPath);
    expect(metrics.totalTests).toBe(2);
    expect(metrics.flaky).toBe(1);
    expect(metrics.status).toBe('fail');
    expect(fs.readFileSync(performancePath, 'utf8')).toBe(performanceBefore);
  });

  it('passes when the complete critical report is clean', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical-playwright-report.json');
    writeReport(criticalPath, [['passed'], ['passed']]);

    const { result, metrics } = runMetrics(root, criticalPath);

    expect(result.status).toBe(0);
    expect(metrics.totalTests).toBe(2);
    expect(metrics.flaky).toBe(0);
    expect(metrics.status).toBe('pass');
  });
});
