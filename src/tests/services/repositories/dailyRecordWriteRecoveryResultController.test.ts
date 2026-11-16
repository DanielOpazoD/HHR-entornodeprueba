// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildAutoMergedRecoveryResult,
  buildBlockedRecoveryResult,
  buildQueuedRetryRecoveryResult,
  buildThrowUnrecoverableRecoveryResult,
  buildUnrecoverableRecoveryResult,
} from '@/services/repositories/dailyRecordWriteRecoveryResultController';

const conflictSummary = {
  kind: 'remote_unavailable' as const,
  sourceOfTruth: 'none' as const,
  localTimestamp: '2026-04-14T00:00:00.000Z',
  changedPaths: ['beds.R1.patientName'],
  message: 'fallback',
};

describe('dailyRecordWriteRecoveryResultController', () => {
  it('builds blocked recovery results', () => {
    const error = new Error('blocked');
    const result = buildBlockedRecoveryResult({
      error,
      blockingReason: 'version_mismatch',
      conflictSummary,
      userSafeMessage: 'blocked',
      observabilityTags: ['daily_record'],
    });

    expect(result.status).toBe('throw');
    expect(result.error).toBe(error);
    expect(result.decision.blockingReason).toBe('version_mismatch');
  });

  it('builds auto-merge, queued retry, and unrecoverable recovery results', () => {
    expect(buildAutoMergedRecoveryResult(conflictSummary, 'merged', ['daily_record']).status).toBe(
      'auto_merged'
    );
    expect(buildQueuedRetryRecoveryResult(conflictSummary, 'queued', ['daily_record']).status).toBe(
      'queued_for_retry'
    );
    expect(
      buildUnrecoverableRecoveryResult(conflictSummary, 'manual', ['daily_record']).status
    ).toBe('unrecoverable');
  });

  it('builds throw unrecoverable results preserving the original error', () => {
    const error = new Error('manual');
    const result = buildThrowUnrecoverableRecoveryResult({
      error,
      conflictSummary,
      userSafeMessage: 'manual',
      observabilityTags: ['daily_record'],
    });

    expect(result.status).toBe('throw');
    expect(result.error).toBe(error);
    expect(result.decision.consistencyState).toBe('unrecoverable');
  });
});
