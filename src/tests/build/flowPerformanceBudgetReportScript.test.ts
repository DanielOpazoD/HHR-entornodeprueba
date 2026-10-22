// @vitest-environment node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('scripts/report-flow-performance-budget.mjs');
const tmpRoots: string[] = [];
const flowNames = [
  'loginVisibleMs',
  'authFeedbackMs',
  'censoVisibleMs',
  'censoRecordReadyMs',
  'clinicalDocumentsVisibleMs',
  'backupFilesVisibleMs',
  'logoutToLoginVisibleMs',
];

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-performance-budget-'));
  tmpRoots.push(root);
  return root;
};

const runReport = (root: string) =>
  spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
  });

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('flow performance budget report script', () => {
  it('publishes both artifacts with complete flow metrics and preserves the source report', () => {
    const root = makeRoot();
    const rawPath = path.join(root, 'reports/e2e/flow-performance-budget.json');
    const raw = `${JSON.stringify({
      generatedAt: '2026-01-01T12:00:00.000Z',
      status: 'passed',
      metrics: Object.fromEntries(flowNames.map(flow => [flow, 100])),
      budgets: Object.fromEntries(
        flowNames.map(flow => [flow, { targetMs: 200, enforcedMaxMs: 300 }])
      ),
      breakdown: { auth: { tokenMs: 25 } },
    })}\n`;
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, raw, 'utf8');

    const result = runReport(root);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      '[flow-performance-budget] Report generated at reports/e2e/flow-performance-budget-summary.json and reports/e2e/flow-performance-budget.md\n'
    );
    const report: unknown = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/e2e/flow-performance-budget-summary.json'), 'utf8')
    );
    expect(report).toEqual({
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      sourceGeneratedAt: '2026-01-01T12:00:00.000Z',
      requiredFlows: flowNames,
      rawStatus: 'passed',
      flows: flowNames.map(flow => ({
        flow,
        actualMs: 100,
        enforcedMaxMs: 300,
        targetMs: 200,
        deltaToTargetMs: -100,
        deltaToEnforcedMs: -200,
        status: 'ok',
      })),
      breakdown: { auth: { tokenMs: 25 } },
      summary: {
        missingFlows: [],
        blockingCount: 0,
        targetMissCount: 0,
        nearLimitCount: 0,
        status: 'passing',
      },
    });
    const markdown = fs.readFileSync(
      path.join(root, 'reports/e2e/flow-performance-budget.md'),
      'utf8'
    );
    expect(markdown).toContain('# Flow Performance Budget Report');
    expect(markdown).toContain('- Source report: 2026-01-01T12:00:00.000Z');
    expect(markdown).toContain('- Status: passing');
    expect(markdown).toContain('| `loginVisibleMs` | 100 | 200 | 300 | -100 | -200 | ok |');
    expect(markdown).toContain('- tokenMs: 25ms');
    expect(fs.readFileSync(rawPath, 'utf8')).toBe(raw);
  });

  it('rejects a missing source report without publishing or announcing artifacts', () => {
    const root = makeRoot();

    const result = runReport(root);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing reports/e2e/flow-performance-budget.json');
    expect(result.stdout).toBe('');
    expect(fs.existsSync(path.join(root, 'reports/e2e/flow-performance-budget-summary.json'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(root, 'reports/e2e/flow-performance-budget.md'))).toBe(false);
  });
});
