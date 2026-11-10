// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

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

// The workflows the contract reads: PR CI, the nightly runtime one and any a nightly suite names.
const governedWorkflows = (): string[] => {
  const config = JSON.parse(fs.readFileSync('scripts/config/test-runtime-governance.json', 'utf8'));
  const named = (config.nightlySuites as Array<{ workflow?: string }>).map(suite => suite.workflow);
  return Array.from(
    new Set(['.github/workflows/ci-cd.yml', '.github/workflows/nightly-test-runtime.yml', ...named])
  ).filter((workflow): workflow is string => Boolean(workflow));
};
const copyGovernedFiles = (root: string): void => {
  for (const relative of [
    ...governedWorkflows(),
    'scripts/config/unit-shard-balance.json',
    'src/tests/services/storage/syncQueueLoad.test.ts',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.copyFileSync(relative, path.join(root, relative));
  }
};

describe('test runtime governance support', () => {
  it('checks shard balance once in the tests aggregate and still rejects an invalid configuration', () => {
    const root = makeReportRoot();
    copyGovernedFiles(root);
    for (const relative of ['src/tests/support', 'src/tests/utils', 'src/tests/integration']) {
      fs.mkdirSync(path.join(root, relative), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'src/tests/integration/setup.tsx'), '');
    for (let index = 1; index <= 4; index += 1) {
      fs.writeFileSync(path.join(root, `src/tests/synthetic${index}.test.ts`), 'export {};');
    }
    const balancePath = path.join(root, 'scripts/config/unit-shard-balance.json');
    const balance = JSON.parse(fs.readFileSync(balancePath, 'utf8'));
    Object.assign(balance, {
      shardCount: 4,
      durationHints: [],
      affinityGroups: [],
      lockedAssignments: {},
      criticalTestGlobs: [],
    });
    fs.writeFileSync(balancePath, JSON.stringify(balance));
    const governance = JSON.parse(
      fs.readFileSync('scripts/config/guardrail-governance.json', 'utf8')
    );
    const balanceCommands = ['check:unit-shard-balance', 'check:test-runtime-governance'];
    governance.qualityAggregate.checks = governance.qualityAggregate.checks.filter(
      (step: { id: string }) => balanceCommands.includes(step.id)
    );
    fs.writeFileSync(
      path.join(root, 'scripts/config/guardrail-governance.json'),
      JSON.stringify(governance)
    );
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    for (const command of balanceCommands) {
      const script = command.replace('check:', 'check-');
      packageJson.scripts[command] = `node "${path.resolve(`scripts/${script}.mjs`)}"`;
    }
    fs.writeFileSync(packagePath, JSON.stringify(packageJson));
    const run = (script: string, args: string[] = []) =>
      spawnSync(process.execPath, [path.resolve(`scripts/${script}.mjs`), ...args], {
        cwd: root,
        encoding: 'utf8',
      });
    expect(run('check-quality-aggregate', ['--group', 'tests']).status).toBe(0);
    expect(run('check-unit-shard-balance').status).toBe(0);
    balance.shardCount = 3;
    fs.writeFileSync(balancePath, JSON.stringify(balance));
    const aggregate = run('check-quality-aggregate', ['--group', 'tests']);
    expect(aggregate.status).toBe(1);
    expect(aggregate.stdout).toContain('check:test-runtime-governance');
    const retained = run('check-test-runtime-governance');
    expect(retained.status).toBe(1);
    expect(retained.stderr).toContain('Unit shard balance must define exactly 4 shards; found 3.');
    const manual = run('check-unit-shard-balance');
    expect(manual.status).toBe(1);
    expect(manual.stderr).toContain('Unit shard balance must define exactly 4 shards; found 3.');
    const profile = JSON.parse(
      fs.readFileSync(path.join(root, 'reports/ci-quality-static-profile-tests.json'), 'utf8')
    );
    expect(profile.results).toEqual([
      expect.objectContaining({ id: 'check:test-runtime-governance', status: 'failed' }),
    ]);
  });
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

  it('reads the workflows by structure, not by indentation or list style', () => {
    const root = makeReportRoot();
    copyGovernedFiles(root);
    for (const relative of ['src/tests/support', 'src/tests/utils', 'src/tests/integration']) {
      fs.mkdirSync(path.join(root, relative), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'src/tests/integration/setup.tsx'), '');
    const ciPath = path.join(root, '.github/workflows/ci-cd.yml');
    const reformatted = parseDocument(fs.readFileSync(ciPath, 'utf8'));
    fs.writeFileSync(ciPath, reformatted.toString({ indent: 4 }));
    expect(collectTestRuntimeGovernanceIssues(root)).toEqual([]);

    reformatted.setIn(['jobs', 'unit-risk-shards', 'strategy', 'matrix', 'shard'], [1, 2, 3]);
    fs.writeFileSync(ciPath, reformatted.toString({ indent: 4 }));
    expect(collectTestRuntimeGovernanceIssues(root)).toContain(
      'unit-risk-shards: CI matrix must keep four explicit shards.'
    );
  });

  it.each(['test:ci:unit', 'test:ci:unit:shard'])(
    'rejects a nightly load suite reintroduced through %s expansion',
    script => {
      const root = makeReportRoot();
      copyGovernedFiles(root);
      for (const relative of ['src/tests/support', 'src/tests/utils']) {
        fs.mkdirSync(path.join(root, relative), { recursive: true });
      }
      fs.mkdirSync(path.join(root, 'src/tests/integration'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src/tests/integration/setup.tsx'), '');
      expect(collectTestRuntimeGovernanceIssues(root)).toEqual([]);
      const file = 'src/tests/services/storage/syncQueueLoad.test.ts';
      if (script === 'test:ci:unit') {
        const packagePath = path.join(root, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        packageJson.scripts[script] = packageJson.scripts[script].replace(
          ` --exclude "${file}"`,
          ''
        );
        fs.writeFileSync(packagePath, JSON.stringify(packageJson));
      } else {
        const configPath = path.join(root, 'scripts/config/unit-shard-balance.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config.excludedFromUnitSuite = config.excludedFromUnitSuite.filter(
          (excluded: string) => excluded !== file
        );
        fs.writeFileSync(configPath, JSON.stringify(config));
      }
      expect(collectTestRuntimeGovernanceIssues(root)).toEqual([
        `sync-load: nightly-only file ${file} is included indirectly in ${script}.`,
      ]);
    }
  );

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
