// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTestRuntimeGovernanceReport,
  collectTestRuntimeGovernanceIssues,
  formatTestRuntimeGovernanceMarkdown,
} from '../../../scripts/testRuntimeGovernanceSupport.mjs';

type RuntimeSuiteSummary = {
  id: string;
};

const temporaryRoots: string[] = [];
const makeReportRoot = (observation?: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-governance-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'scripts/config'), { recursive: true });
  fs.copyFileSync(
    'scripts/config/test-runtime-governance.json',
    path.join(root, 'scripts/config/test-runtime-governance.json')
  );
  fs.copyFileSync('package.json', path.join(root, 'package.json'));
  if (observation) {
    fs.mkdirSync(path.join(root, 'reports'));
    fs.writeFileSync(
      path.join(root, 'reports/ci-runtime-observed-profile.json'),
      JSON.stringify(observation)
    );
  }
  return root;
};
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('test runtime governance support', () => {
  it('keeps PR-critical and nightly test surfaces explicit', () => {
    const report = buildTestRuntimeGovernanceReport(process.cwd());

    expect(report.summary.prBlockingSuites).toBeGreaterThanOrEqual(4);
    expect(report.summary.nightlySuites).toBeGreaterThanOrEqual(3);
    expect(report.prBlockingSuites.map((suite: RuntimeSuiteSummary) => suite.id)).toEqual(
      expect.arrayContaining([
        'unit-risk-shards',
        'clinical-sync-release-gate',
        'rules-emulator',
        'e2e-critical',
      ])
    );
    expect(report.nightlySuites.map((suite: RuntimeSuiteSummary) => suite.id)).toEqual(
      expect.arrayContaining(['sync-load', 'clinical-stability', 'release-confidence-full'])
    );
  });

  it('fails if CI/runtime governance drifts from the contract', () => {
    expect(collectTestRuntimeGovernanceIssues(process.cwd())).toEqual([]);
  });

  it('renders a compact report with slow-test and fixture governance sections', () => {
    const report = buildTestRuntimeGovernanceReport(process.cwd());
    const markdown = formatTestRuntimeGovernanceMarkdown(report);

    expect(report.fixtureGovernance.signals.length).toBeGreaterThanOrEqual(3);
    expect(markdown).toContain('# Test Runtime Governance');
    expect(markdown).toContain('## PR Blocking Suites');
    expect(markdown).toContain('## Nightly Suites');
    expect(markdown).toContain('## Slow Runtime Signals');
    expect(markdown).toContain('CI observed unit shard runtime');
    expect(markdown).toContain('## Fixture Duplication Governance');
    expect(markdown).toContain('## Fixture Duplication Signals');
  });
  it('preserves the source of a stored observation instead of assigning this report commit', () => {
    const source = {
      provider: 'github-actions',
      repository: 'example/repo',
      runId: '123',
      status: 'collected',
    };
    const root = makeReportRoot({
      source,
      generatedAt: '2026-01-01T00:00:00Z',
      gitSha: 'old-sha',
      status: 'ok',
      summary: { observedShardCount: 4, spreadPercent: 16.4 },
    });
    const report = buildTestRuntimeGovernanceReport(root);
    expect(report.slowRuntimeSignals.ciRuntimeObserved).toMatchObject({
      source,
      generatedAt: '2026-01-01T00:00:00Z',
      gitSha: 'old-sha',
      status: 'ok',
    });
    const markdown = formatTestRuntimeGovernanceMarkdown(report);
    expect(markdown).toContain('stored observation; not a measurement of this report run');
    expect(markdown).toContain('repository: example/repo; run: 123');
    expect(markdown).toContain(
      'Stored profile generated: 2026-01-01T00:00:00Z; profile commit: old-sha'
    );
    expect(markdown).toContain('16.4% observed spread');
  });

  it.each([undefined, { status: 'ok', summary: { observedShardCount: 4 } }])(
    'does not manufacture provenance for missing or legacy observations (%j)',
    observation => {
      const report = buildTestRuntimeGovernanceReport(makeReportRoot(observation));
      const markdown = formatTestRuntimeGovernanceMarkdown(report);
      expect(markdown).toContain('run: unknown');
      expect(markdown).toContain('profile commit: unknown');
      expect(markdown).toContain('missing provenance cannot establish freshness');
    }
  );
});
