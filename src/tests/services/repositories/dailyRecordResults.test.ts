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

  it('rejects invalid updatePartial patchedFields values', () => {
    expect(() =>
      createUpdatePartialDailyRecordResult({
        date: '2026-02-19',
        outcome: 'blocked',
        savedLocally: true,
        updatedRemotely: false,
        queuedForRetry: true,
        autoMerged: false,
        patchedFields: 0,
      })
    ).toThrow(/patchedFields >= 1/);
  });
});
