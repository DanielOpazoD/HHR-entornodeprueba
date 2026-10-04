// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPlaywrightReportIssues } from '../../../scripts/check-playwright-report-clean.mjs';

const tmpRoots: string[] = [];

const makeRawReport = (report: unknown) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-report-clean-'));
  tmpRoots.push(root);
  const reportPath = path.join(root, 'playwright-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report), 'utf8');
  return reportPath;
};

const makeReport = (stats: Record<string, unknown>) => makeRawReport({ stats });

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

  it('rejects global teardown errors even when all recorded tests passed', () => {
    const reportPath = makeRawReport({
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      errors: [{ message: 'Synthetic global teardown failure' }],
    });
    expect(collectPlaywrightReportIssues(reportPath)).toContain(
      'playwright report has 1 global error(s); release evidence is incomplete.'
    );
  });

  it('accepts an explicitly empty global error list', () => {
    const reportPath = makeRawReport({
      stats: { expected: 1, unexpected: 0, flaky: 0 },
      errors: [],
    });
    expect(collectPlaywrightReportIssues(reportPath)).toEqual([]);
  });

  it.each([null, [], 1, 'invalid'])('rejects malformed report root %j', report => {
    expect(collectPlaywrightReportIssues(makeRawReport(report))).toContain(
      'playwright report must be a JSON object.'
    );
  });

  it.each([null, {}, 'none', false])('rejects malformed global errors %j', errors => {
    const reportPath = makeRawReport({
      stats: { expected: 1, unexpected: 0, flaky: 0 },
      errors,
    });
    expect(collectPlaywrightReportIssues(reportPath)).toContain(
      'playwright report has an invalid global errors list.'
    );
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
      'critical-e2e did not record any executed tests.'
    );
  });
  it('rejects a skipped-only report that never exercised the application', () => {
    const reportPath = makeReport({ expected: 0, unexpected: 0, flaky: 0, skipped: 38 });
    expect(collectPlaywrightReportIssues(reportPath)).toContain(
      'playwright report did not record any executed tests.'
    );
  });

  it('accepts executed evidence with explicitly skipped unrelated cases', () => {
    const reportPath = makeReport({ expected: 12, unexpected: 0, flaky: 0, skipped: 2 });
    expect(collectPlaywrightReportIssues(reportPath)).toEqual([]);
  });

  it.each([
    ['expected', -1],
    ['expected', 1.5],
    ['expected', undefined],
    ['unexpected', 'invalid'],
    ['unexpected', '0'],
    ['flaky', null],
    ['flaky', -1],
    ['skipped', -1],
    ['interrupted', true],
  ])('rejects malformed %s count (%s) instead of treating it as zero', (field, value) => {
    const reportPath = makeReport({ expected: 12, unexpected: 0, flaky: 0, [field]: value });
    expect(collectPlaywrightReportIssues(reportPath)).toContain(
      `playwright report has an invalid ${field} count; expected a non-negative safe integer.`
    );
  });
});
