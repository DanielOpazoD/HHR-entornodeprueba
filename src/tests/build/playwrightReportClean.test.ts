import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPlaywrightReportIssues } from '../../../scripts/check-playwright-report-clean.mjs';

const tmpRoots: string[] = [];

const makeReport = (stats: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-report-clean-'));
  tmpRoots.push(root);
  const reportPath = path.join(root, 'playwright-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ stats }), 'utf8');
  return reportPath;
};

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('playwright report clean guardrail', () => {
  it('accepts a report with expected tests and no release-blocking outcomes', () => {
    const reportPath = makeReport({ expected: 12, unexpected: 0, flaky: 0, interrupted: 0 });

    expect(collectPlaywrightReportIssues(reportPath, { label: 'critical-e2e' })).toEqual([]);
  });

  it('rejects flaky critical e2e evidence even when retries recovered', () => {
    const reportPath = makeReport({ expected: 11, unexpected: 0, flaky: 1, interrupted: 0 });

    expect(collectPlaywrightReportIssues(reportPath, { label: 'critical-e2e' })).toContain(
      'critical-e2e has 1 flaky test(s); release evidence must be stable without retries.'
    );
  });

  it('rejects interrupted evidence because the clinical flow was not fully observed', () => {
    const reportPath = makeReport({ expected: 8, unexpected: 0, flaky: 0, interrupted: 1 });

    expect(collectPlaywrightReportIssues(reportPath, { label: 'critical-e2e' })).toContain(
      'critical-e2e has 1 interrupted test(s); release evidence is incomplete.'
    );
  });

  it('rejects empty reports that do not prove any clinical path', () => {
    const reportPath = makeReport({
      expected: 0,
      unexpected: 0,
      flaky: 0,
      interrupted: 0,
      skipped: 0,
    });

    expect(collectPlaywrightReportIssues(reportPath, { label: 'critical-e2e' })).toContain(
      'critical-e2e did not record any executed or skipped tests.'
    );
  });
});
