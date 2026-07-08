import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EVIDENCE_DEPENDENCY_GRAPH,
  getEvidenceReportDependencyFiles,
  getEvidenceReportDependencies,
} from '../../../scripts/evidenceDependencyGraph.mjs';
import {
  buildReleaseReadinessPlan,
  getCriticalCoverageReuseInputs,
  isCriticalCoverageArtifactReusable,
  RELEASE_READINESS_INPUTS,
} from '../../../scripts/releaseReadinessRunnerSupport.mjs';

const tempRoots: string[] = [];

type ReleaseReadinessStep = {
  command: string;
};

type ReleaseReadinessPlan = {
  steps: ReleaseReadinessStep[];
};

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-graph-'));
  tempRoots.push(root);
  return root;
};

const writeJson = (root: string, relativePath: string, value: unknown) => {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeText = (root: string, relativePath: string, value: string) => {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, 'utf8');
};

const touch = (root: string, relativePath: string, date: Date) => {
  fs.utimesSync(path.join(root, relativePath), date, date);
};

const findCriticalCoverageStep = (plan: ReleaseReadinessPlan) =>
  plan.steps.find(step => step.command === 'report:critical-coverage');

const writeReusableCriticalCoverage = (root: string, overrides: Record<string, unknown> = {}) => {
  writeJson(root, 'reports/critical-coverage.json', {
    generatedAt: '2026-07-01T10:00:00.000Z',
    gitSha: 'abc1234',
    gitDirty: false,
    status: 'passing',
    ...overrides,
  });
  writeText(root, 'reports/critical-coverage.md', '# Critical Coverage Report\n');
  writeText(root, 'scripts/config/critical-coverage-thresholds.json', '{"zones":{}}\n');
  writeText(
    root,
    'scripts/criticalCoverageSupport.mjs',
    'export const buildReport = () => ({});\n'
  );
  writeText(root, 'scripts/report-critical-coverage.mjs', '#!/usr/bin/env node\n');
  writeText(root, 'vitest.critical-coverage.config.ts', 'export default {};\n');
  writeText(root, 'scripts/run-critical-coverage.mjs', '#!/usr/bin/env node\n');

  const generatedAt = new Date('2026-07-01T10:00:00.000Z');
  touch(root, 'reports/critical-coverage.json', generatedAt);
  touch(root, 'reports/critical-coverage.md', generatedAt);
  touch(
    root,
    'scripts/config/critical-coverage-thresholds.json',
    new Date('2026-07-01T09:00:00.000Z')
  );
  touch(root, 'scripts/criticalCoverageSupport.mjs', new Date('2026-07-01T09:00:00.000Z'));
  touch(root, 'scripts/report-critical-coverage.mjs', new Date('2026-07-01T09:00:00.000Z'));
  touch(root, 'vitest.critical-coverage.config.ts', new Date('2026-07-01T09:00:00.000Z'));
  touch(root, 'scripts/run-critical-coverage.mjs', new Date('2026-07-01T09:00:00.000Z'));
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('evidence dependency graph', () => {
  it('uses shell-free git execution when building provenance metadata', () => {
    const support = fs.readFileSync(
      path.join(process.cwd(), 'scripts/evidenceProvenanceSupport.mjs'),
      'utf8'
    );

    expect(support).toContain("import { execFileSync } from 'node:child_process'");
    expect(support).toContain("execFileSync('git', ['rev-parse', 'HEAD^{tree}']");
    expect(support).not.toContain("execSync('git rev-parse HEAD^{tree}'");
  });

  it('declares release readiness dependencies including critical coverage artifacts', () => {
    expect(EVIDENCE_DEPENDENCY_GRAPH['release-readiness-scorecard']).toMatchObject({
      command: 'report:release-readiness-scorecard',
      artifacts: [
        'reports/release-readiness-scorecard.json',
        'reports/release-readiness-scorecard.md',
      ],
    });

    expect(getEvidenceReportDependencies('release-readiness-scorecard')).toEqual(
      expect.arrayContaining([
        'quality-metrics',
        'critical-coverage',
        'system-confidence',
        'operational-health',
        'release-confidence-matrix',
        'technical-ownership-map',
        'guardrail-governance',
        'compatibility-import-governance',
      ])
    );
  });

  it('links observed CI runtime telemetry to the unit shard runtime evidence node', () => {
    expect(getEvidenceReportDependencies('ci-runtime-observed-profile')).toEqual(
      expect.arrayContaining([
        'unit-shard-runtime-profile',
        'scripts/collect-github-actions-runtime.mjs',
        'scripts/check-ci-runtime-telemetry.mjs',
        'scripts/ciRuntimeTelemetrySupport.mjs',
        'src/tests/build/collectGithubActionsRuntime.test.ts',
      ])
    );
    expect(getEvidenceReportDependencies('ci-runtime-observed-profile')).not.toContain(
      'reports/unit-shard-runtime-profile.json'
    );
  });

  it('derives release readiness runner inputs from the evidence graph', () => {
    expect(RELEASE_READINESS_INPUTS).toEqual(
      getEvidenceReportDependencies('release-readiness-scorecard')
    );
  });

  it('expands release readiness dependency files transitively', () => {
    expect(getEvidenceReportDependencyFiles('release-readiness-scorecard')).toEqual(
      expect.arrayContaining([
        'reports/quality-metrics.json',
        'reports/bundle-risk-ledger.json',
        'reports/operational-health.json',
        'reports/system-confidence.json',
        'reports/critical-coverage.json',
        'scripts/config/critical-coverage-thresholds.json',
        'scripts/report-critical-coverage.mjs',
        'reports/e2e/preview-bootstrap/report.json',
      ])
    );
  });

  it('accepts critical coverage reuse only for matching sha, clean/dirty state and fresh dependencies', () => {
    const root = makeTempRoot();
    writeReusableCriticalCoverage(root);

    for (const dependency of getCriticalCoverageReuseInputs().dependencies) {
      expect(fs.existsSync(path.join(root, dependency))).toBe(true);
    }

    expect(
      isCriticalCoverageArtifactReusable(root, {
        gitSha: 'abc1234',
        gitDirty: false,
      })
    ).toMatchObject({ reusable: true });
  });

  it('rejects critical coverage reuse when artifacts are missing', () => {
    const root = makeTempRoot();

    expect(
      isCriticalCoverageArtifactReusable(root, {
        gitSha: 'abc1234',
        gitDirty: false,
      })
    ).toMatchObject({
      reusable: false,
      reason: expect.stringContaining('missing'),
    });
  });

  it('rejects critical coverage reuse when git sha differs', () => {
    const root = makeTempRoot();
    writeReusableCriticalCoverage(root, { gitSha: 'stale999' });

    expect(
      isCriticalCoverageArtifactReusable(root, {
        gitSha: 'abc1234',
        gitDirty: false,
      })
    ).toMatchObject({
      reusable: false,
      reason: expect.stringContaining('gitSha'),
    });
  });

  it('rejects critical coverage reuse when a dependency is newer than the artifact', () => {
    const root = makeTempRoot();
    writeReusableCriticalCoverage(root);
    touch(
      root,
      'scripts/config/critical-coverage-thresholds.json',
      new Date('2026-07-01T11:00:00.000Z')
    );

    expect(
      isCriticalCoverageArtifactReusable(root, {
        gitSha: 'abc1234',
        gitDirty: false,
      })
    ).toMatchObject({
      reusable: false,
      reason: expect.stringContaining('critical-coverage-thresholds.json'),
    });
  });

  it('builds a release readiness plan that skips critical coverage only on valid reuse', () => {
    const root = makeTempRoot();
    writeReusableCriticalCoverage(root);

    const reusablePlan = buildReleaseReadinessPlan(root, {
      gitSha: 'abc1234',
      gitDirty: false,
    });
    expect(findCriticalCoverageStep(reusablePlan)).toMatchObject({
      action: 'reuse',
    });

    const stalePlan = buildReleaseReadinessPlan(root, {
      gitSha: 'new5678',
      gitDirty: false,
    });
    expect(findCriticalCoverageStep(stalePlan)).toMatchObject({
      action: 'run',
    });
  });
});
