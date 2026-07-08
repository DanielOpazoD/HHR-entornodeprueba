import { describe, expect, it } from 'vitest';
import {
  buildSyncConvergenceEvidenceReport,
  evaluateSyncConvergenceEvidence,
  formatSyncConvergenceEvidenceReport,
} from '../../../scripts/syncConvergenceEvidenceSupport.mjs';

describe('sync convergence evidence support', () => {
  it('accepts the current sync convergence, replay and recovery evidence contract', () => {
    const result = evaluateSyncConvergenceEvidence(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.sections.map(section => section.id)).toEqual([
      'sync-convergence',
      'authority-replay',
      'recovery-readiness',
      'clinical-sync-simulator',
    ]);
    expect(
      result.sections.flatMap(section => section.checks.map((check: { id: string }) => check.id))
    ).toEqual(
      expect.arrayContaining([
        'diagnostic-status-contract',
        'truth-selection-telemetry',
        'planner-no-aggressive-writes',
        'three-client-replay-coverage',
        'multi-client-simulator-coverage',
        'auditable-clinical-context',
        'census-replay-scenarios',
        'handoff-replay-scenarios',
      ])
    );
  });

  it('formats a compact markdown report for release evidence', () => {
    const report = buildSyncConvergenceEvidenceReport(process.cwd());
    const markdown = formatSyncConvergenceEvidenceReport(report);

    expect(report.reportId).toBe('sync-convergence');
    expect(report.summary.ok).toBe(true);
    expect(markdown).toContain('# Sync Convergence Evidence');
    expect(markdown).toContain('Post-merge convergence');
    expect(markdown).toContain('Authority replay traceability');
    expect(markdown).toContain('Conservative recovery readiness');
    expect(markdown).toContain('Clinical sync simulator');
  });
});
