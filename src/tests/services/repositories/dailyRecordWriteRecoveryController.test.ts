// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
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
});
