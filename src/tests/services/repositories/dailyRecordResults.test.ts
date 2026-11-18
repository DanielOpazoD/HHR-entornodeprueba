// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

describe('dailyRecordResults contracts', () => {
  it('accepts valid save result payload', () => {
    const result = createSaveDailyRecordResult({
      date: '2026-02-19',
      outcome: 'queued',
      savedLocally: true,
      savedRemotely: false,
      queuedForRetry: true,
      autoMerged: false,
    });
    expect(result.queuedForRetry).toBe(true);
  });

  it('derives the same default state for a full save and a partial update', () => {
    const base = {
      date: '2026-02-19',
      savedLocally: true,
      queuedForRetry: false,
      autoMerged: false,
    };
    expect(
      createSaveDailyRecordResult({ ...base, outcome: 'clean', savedRemotely: true })
        .consistencyState
    ).toBe('persisted_and_synced');
    expect(
      createUpdatePartialDailyRecordResult({ ...base, outcome: 'clean', updatedRemotely: true })
        .consistencyState
    ).toBe('persisted_and_synced');
    expect(
      createUpdatePartialDailyRecordResult({ ...base, outcome: 'clean', updatedRemotely: false })
        .consistencyState
    ).toBe('persisted_local_only');
  });
});
