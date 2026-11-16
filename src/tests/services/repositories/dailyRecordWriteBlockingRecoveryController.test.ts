// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { resolveBlockedRemoteWriteRecovery } from '@/services/repositories/dailyRecordWriteBlockingRecoveryController';

describe('dailyRecordWriteBlockingRecoveryController', () => {
  it('builds a blocked regression recovery result', () => {
    const error = new DataRegressionError('regression', 1, 2);

    const result = resolveBlockedRemoteWriteRecovery(error, (kind, message) => ({
      kind,
      sourceOfTruth: 'none',
      localTimestamp: '2026-04-15T10:00:00.000Z',
      changedPaths: ['beds.R1.patientName'],
      message,
    }));

    expect(result?.status).toBe('throw');
    expect(result?.decision.blockingReason).toBe('regression');
    expect(result?.decision.userSafeMessage).toBe('regression');
  });

  it('returns null for non-blocking errors', () => {
    const result = resolveBlockedRemoteWriteRecovery(new Error('network'), (kind, message) => ({
      kind,
      sourceOfTruth: 'none',
      localTimestamp: undefined,
      changedPaths: ['*'],
      message,
    }));

    expect(result).toBeNull();
  });

  it('maps version mismatches to the matching blocking reason', () => {
    const error = new VersionMismatchError('version mismatch');

    const result = resolveBlockedRemoteWriteRecovery(error, (kind, message) => ({
      kind,
      sourceOfTruth: 'none',
      localTimestamp: undefined,
      changedPaths: ['*'],
      message,
    }));

    expect(result).not.toBeNull();
    expect(result?.decision.blockingReason).toBe('version_mismatch');
    expect(result?.decision.conflictSummary?.kind).toBe('version_mismatch');
  });
});
