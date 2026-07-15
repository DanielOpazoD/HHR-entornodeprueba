import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConcurrencyRemoteWriteRecovery } from '@/services/repositories/dailyRecordWriteConcurrencyRecoveryController';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/repositories/dailyRecordConflictAutoMergeController', () => ({
  attemptConflictAutoMergeRecovery: vi.fn(),
}));

import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-04-15T10:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordWriteConcurrencyRecoveryController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an auto-merged recovery result when merge succeeds', async () => {
    vi.mocked(attemptConflictAutoMergeRecovery).mockResolvedValueOnce({ status: 'auto_merged' });

    const result = await resolveConcurrencyRemoteWriteRecovery(
      '2026-04-15',
      buildRecord('2026-04-15'),
      ['*'],
      new Error('Concurrency conflict'),
      (kind, message) => ({
        kind,
        sourceOfTruth: 'none',
        localTimestamp: '2026-04-15T10:00:00.000Z',
        changedPaths: ['*'],
        message,
      })
    );

    expect(result.status).toBe('auto_merged');
    expect(result.autoMerged).toBe(true);
    expect(result.decision.conflictSummary?.kind).toBe('concurrency');
  });

  it('returns an unrecoverable throw result when merge is not possible', async () => {
    const error = new Error('Concurrency conflict');
    vi.mocked(attemptConflictAutoMergeRecovery).mockResolvedValueOnce({ status: 'not_possible' });

    const result = await resolveConcurrencyRemoteWriteRecovery(
      '2026-04-15',
      buildRecord('2026-04-15'),
      ['beds.R1.patientName'],
      error,
      (kind, message) => ({
        kind,
        sourceOfTruth: 'none',
        localTimestamp: '2026-04-15T10:00:00.000Z',
        changedPaths: ['beds.R1.patientName'],
        message,
      })
    );

    expect(result.status).toBe('throw');
    expect(result.autoMerged).toBe(false);
    expect(result.error).toBe(error);
    expect(result.decision.conflictSummary?.kind).toBe('concurrency');
  });

  it('never auto-merges a stale movement reclassification', async () => {
    const error = new Error('Concurrent reclassification');
    const result = await resolveConcurrencyRemoteWriteRecovery(
      '2026-04-15',
      buildRecord('2026-04-15'),
      ['discharges', 'cma'],
      error,
      (kind, message) => ({
        kind,
        sourceOfTruth: 'none',
        localTimestamp: '2026-04-15T10:00:00.000Z',
        changedPaths: ['discharges', 'cma'],
        message,
      }),
      false
    );

    expect(result.status).toBe('throw');
    expect(result.error).toBe(error);
    expect(attemptConflictAutoMergeRecovery).not.toHaveBeenCalled();
    expect(result.decision.observabilityTags).toContain('reclassification_conflict');
  });
});
