import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateSyncInvariants } from '../../../scripts/syncInvariantsSupport.mjs';

describe('sync invariants support', () => {
  afterEach(() => vi.restoreAllMocks());

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

  it.each([
    ['firestoreSyncTransport.ts', /if\s*\(\s*hasRemoteAppliedMutation\(/, 'if (missingMutationCheck('],
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
