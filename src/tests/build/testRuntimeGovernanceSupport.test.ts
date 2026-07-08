import { describe, expect, it } from 'vitest';

import {
  buildTestRuntimeGovernanceReport,
  collectTestRuntimeGovernanceIssues,
  formatTestRuntimeGovernanceMarkdown,
} from '../../../scripts/testRuntimeGovernanceSupport.mjs';

type RuntimeSuiteSummary = {
  id: string;
};

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
});
