import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPlaywrightReportPathIsolationIssues } from '../../../scripts/check-playwright-report-path-isolation.mjs';

const tmpRoots: string[] = [];

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-report-isolation-'));
  tmpRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Playwright report path isolation', () => {
  it('accepts two independent report files', () => {
    const root = makeRoot();

    expect(
      collectPlaywrightReportPathIsolationIssues(
        path.join(root, 'critical.json'),
        path.join(root, 'performance.json')
      )
    ).toEqual([]);
  });

  it('rejects normalized aliases for the same report file', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical.json');

    expect(
      collectPlaywrightReportPathIsolationIssues(
        criticalPath,
        path.join(root, '.', 'critical.json')
      )
    ).toContain('Critical E2E and flow performance reports must use different paths.');
  });

  it('rejects a dangling symlink that could redirect critical evidence', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical.json');
    const performancePath = path.join(root, 'performance.json');
    fs.symlinkSync(performancePath, criticalPath);

    expect(collectPlaywrightReportPathIsolationIssues(criticalPath, performancePath)).toContain(
      'Critical E2E report path must not be a symbolic link.'
    );
  });

  it('rejects hardlinks that refer to the same existing file', () => {
    const root = makeRoot();
    const criticalPath = path.join(root, 'critical.json');
    const performancePath = path.join(root, 'performance.json');
    fs.writeFileSync(criticalPath, '{}', 'utf8');
    fs.linkSync(criticalPath, performancePath);

    expect(collectPlaywrightReportPathIsolationIssues(criticalPath, performancePath)).toContain(
      'Critical E2E and flow performance reports must not share the same file.'
    );
  });
});
