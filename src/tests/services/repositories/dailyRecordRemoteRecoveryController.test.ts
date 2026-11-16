// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveQueuedRetryRecoveryResult,
  resolveRemoteUnavailableRecoveryResult,
} from '@/services/repositories/dailyRecordRemoteRecoveryController';

const conflictSummary = {
  kind: 'remote_unavailable' as const,
  sourceOfTruth: 'none' as const,
  localTimestamp: '2026-04-15T00:00:00.000Z',
  changedPaths: ['beds.R1.patientName'],
  message: 'fallback',
};

describe('dailyRecordRemoteRecoveryController', () => {
  it('builds queued retry result when the retry task is accepted', () => {
    const result = resolveQueuedRetryRecoveryResult(true, conflictSummary);

    expect(result.status).toBe('queued_for_retry');
    expect(result.decision.consistencyState).toBe('queued_for_retry');
  });

  it('builds unrecoverable queue backpressure result when the retry task is rejected', () => {
    const result = resolveQueuedRetryRecoveryResult(false, conflictSummary);

    expect(result.status).toBe('unrecoverable');
    expect(result.decision.observabilityTags).toContain('queue_backpressure');
    expect(result.decision.userSafeMessage).toContain('cola de sincronización');
  });

  it('builds unrecoverable remote unavailable result', () => {
    const result = resolveRemoteUnavailableRecoveryResult(conflictSummary);

    expect(result.status).toBe('unrecoverable');
    expect(result.decision.observabilityTags).toContain('unrecoverable');
  });
});
