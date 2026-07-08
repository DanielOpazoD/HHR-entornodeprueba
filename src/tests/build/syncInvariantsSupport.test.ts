import { describe, expect, it } from 'vitest';
import { evaluateSyncInvariants } from '../../../scripts/syncInvariantsSupport.mjs';

describe('sync invariants support', () => {
  it('summarizes the release-critical local Firebase sync invariants', () => {
    const result = evaluateSyncInvariants(process.cwd());

    expect(result.ok).toBe(true);
    expect(result.invariants.map(invariant => invariant.id)).toEqual([
      'atomic-sync-claim-api',
      'claimed-completion-telemetry',
      'authority-release-gate',
      'strict-repository-local-persistence',
      'sync-runbook',
      'full-save-sync-contract',
      'pre-outbox-direct-write-ack',
      'sync-contract-coalescing',
      'idempotent-mutation-drain',
    ]);
  });
});
