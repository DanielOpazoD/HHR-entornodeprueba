import { describe, expect, it, vi } from 'vitest';
import { applyConfirmedRayenImport } from '@/features/rayen-import/hooks/confirmRayenImport';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { ApplyResult } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

describe('applyConfirmedRayenImport', () => {
  it('retries a named concurrency conflict with a record freshly loaded from persistence', async () => {
    vi.useFakeTimers();
    const stale = record('stale');
    const fresh = record('fresh');
    const expected = { record: fresh, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValue(fresh);

    const pending = applyConfirmedRayenImport({
      applyPreviousDays: false,
      base: stale,
      diff: {} as CensusImportDiff,
      dailyRecord: {} as DailyRecordRepositoryPort,
      isAdmin: false,
      ensureRun: vi.fn(),
      applyDiff,
      getFreshRecord,
      createId: () => 'id',
    });

    await vi.advanceTimersByTimeAsync(900);
    await expect(pending).resolves.toBe(expected);
    expect(getFreshRecord).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh, expect.anything());
    vi.useRealTimers();
  });
});
