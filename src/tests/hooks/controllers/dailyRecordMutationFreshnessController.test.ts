import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { saveDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';

const record = {
  date: '2026-08-07',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-08-08T01:00:00.000Z',
} as DailyRecord;

describe('saveDailyRecordWithCompatibility', () => {
  it('keeps the explicit base revision when the saved record has already been restamped', async () => {
    const saveDetailed = vi.fn().mockResolvedValue(null);
    const repository = { saveDetailed } as unknown as DailyRecordRepositoryPort;

    await saveDailyRecordWithCompatibility(
      repository,
      record,
      '2026-08-07T23:00:00.000Z'
    );

    expect(saveDetailed).toHaveBeenCalledWith(record, '2026-08-07T23:00:00.000Z');
  });

  it('passes remote confirmation intent only for an explicit structural handoff', async () => {
    const saveDetailed = vi.fn().mockResolvedValue(null);
    const repository = { saveDetailed } as unknown as DailyRecordRepositoryPort;

    await saveDailyRecordWithCompatibility(
      repository,
      record,
      '2026-08-07T23:00:00.000Z',
      { requireConfirmedRecord: true }
    );

    expect(saveDetailed).toHaveBeenCalledWith(record, '2026-08-07T23:00:00.000Z', {
      requireConfirmedRecord: true,
    });
  });
});
