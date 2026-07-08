import { describe, expect, it } from 'vitest';
import {
  buildDailyRecordConflictSummary,
  buildRecoveryTaskMeta,
  resolveEffectiveChangedPaths,
  resolveRetryOrigin,
} from '@/services/repositories/dailyRecordWriteRecoveryController';

describe('dailyRecordWriteRecoveryController', () => {
  it('falls back to wildcard path when changed paths are empty', () => {
    expect(resolveEffectiveChangedPaths([])).toEqual(['*']);
  });

  it('resolves retry origin from effective changed paths', () => {
    expect(resolveRetryOrigin([])).toBe('full_save_retry');
    expect(resolveRetryOrigin(['beds.R1.patientName'])).toBe('partial_update_retry');
  });

  it('builds recovery task meta from changed paths and origin', () => {
    expect(buildRecoveryTaskMeta(['beds.R1.patientName'], 'partial_update_retry')).toEqual({
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        changedPaths: ['beds.R1.patientName'],
      },
    });
  });

  it('builds concurrency conflict summary with local source of truth', () => {
    expect(
      buildDailyRecordConflictSummary(
        '2026-04-14T10:00:00.000Z',
        ['beds.R1.patientName'],
        'concurrency',
        'conflict'
      )
    ).toEqual({
      kind: 'concurrency',
      sourceOfTruth: 'local',
      localTimestamp: '2026-04-14T10:00:00.000Z',
      changedPaths: ['beds.R1.patientName'],
      message: 'conflict',
    });
  });
});
