// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_DEPENDENCY_GRAPH,
  getEvidenceReportDependencyFiles,
  getEvidenceReportDependencies,
  getEvidenceReportFileDependencies,
} from '../../../scripts/evidenceDependencyGraph.mjs';

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

  it('links observed CI runtime telemetry to the unit shard runtime evidence node', () => {
    expect(getEvidenceReportDependencies('ci-runtime-observed-profile')).toEqual([
      'unit-shard-runtime-profile',
    ]);
    expect(getEvidenceReportFileDependencies('ci-runtime-observed-profile')).toEqual(
      expect.arrayContaining([
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

  it('expands operational health dependency files transitively', () => {
    expect(getEvidenceReportDependencyFiles('operational-health')).toEqual(
      expect.arrayContaining([
        'reports/critical-coverage.json',
        'reports/critical-coverage.md',
        'scripts/config/critical-coverage-thresholds.json',
        'scripts/report-critical-coverage.mjs',
        'reports/e2e/flow-performance-budget-summary.json',
        'reports/e2e/preview-bootstrap/report.json',
        'reports/e2e/preview-bootstrap/ci-provenance.json',
        'reports/test-execution-manifest.json',
      ])
    );
  });

  it('includes direct dependency artifacts but omits nested dependencies when transitive is false', () => {
    const qualityMetrics = EVIDENCE_DEPENDENCY_GRAPH['quality-metrics'];
    const originalDependencies = qualityMetrics.dependencies;
    qualityMetrics.dependencies = ['operational-health'];

    try {
      const files = getEvidenceReportDependencyFiles('quality-metrics', {
        transitive: false,
      });

      expect(files).toEqual(
        expect.arrayContaining(['reports/operational-health.json', 'reports/operational-health.md'])
      );
      expect(files).not.toContain('reports/critical-coverage.json');
      expect(files).not.toContain('reports/critical-coverage.md');
    } finally {
      qualityMetrics.dependencies = originalDependencies;
    }
  });

  it('keeps report dependencies separate from explicit file dependencies', () => {
    expect(getEvidenceReportDependencies('operational-health')).toEqual(['critical-coverage']);
    expect(getEvidenceReportFileDependencies('operational-health')).toEqual([
      'reports/e2e/flow-performance-budget-summary.json',
      'reports/e2e/preview-bootstrap/report.json',
      'reports/e2e/preview-bootstrap/ci-provenance.json',
      'reports/test-execution-manifest.json',
    ]);
  });
});
