// @vitest-environment node
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSyncConvergenceEvidenceReport,
  evaluateSyncConvergenceEvidence,
  formatSyncConvergenceEvidenceReport,
} from '../../../scripts/syncConvergenceEvidenceSupport.mjs';
import { evaluateSyncInvariants } from '../../../scripts/syncInvariantsSupport.mjs';

describe('sync invariants support', () => {
  afterEach(() => vi.restoreAllMocks());

  it('summarizes the release-critical local Firebase sync invariants', () => {
    const result = evaluateSyncInvariants(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.invariants.map(invariant => invariant.id)).toEqual([
      'atomic-sync-claim-api',
      'claimed-completion-telemetry',
      'strict-repository-local-persistence',
      'sync-runbook',
      'full-save-sync-contract',
      'pre-outbox-direct-write-ack',
      'sync-contract-coalescing',
      'idempotent-mutation-drain',
    ]);
  });

  it.each([
    [
      'firestoreSyncTransport.ts',
      /if\s*\(\s*hasRemoteAppliedMutation\(/,
      'if (missingMutationCheck(',
    ],
    ['firestoreSyncTransport.ts', 'record: docToRecord(remoteData, record.date)', 'record: null'],
    ['firestoreSyncTransport.ts', 'return { authoritativeRecord: resolved.record }', 'return'],
    [
      'syncQueueEngine.ts',
      /store\.deleteClaimed\(\s*task\.id,\s*claim,\s*result\.authoritativeRecord\s*\)/,
      'store.deleteClaimed(task.id, claim)',
    ],
  ])('rejects broken idempotent ACK evidence in %s: %s', (file, before, after) => {
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((path, options) => {
      const value = readFileSync(path, options);
      return typeof value === 'string' && String(path).endsWith(file)
        ? value.replace(before, after)
        : value;
    });

    const result = evaluateSyncInvariants(process.cwd());

    expect(
      result.invariants.find(invariant => invariant.id === 'idempotent-mutation-drain')
    ).toMatchObject({ ok: false });
  });
});

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
        'truth-selection-telemetry',
        'three-client-replay-coverage',
        'multi-client-simulator-coverage',
        'auditable-clinical-context',
        'census-replay-scenarios',
        'handoff-replay-scenarios',
        'rayen-acceptance-idempotence',
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
