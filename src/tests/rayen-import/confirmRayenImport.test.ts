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
  it('retries a named concurrency conflict with a record freshly loaded into the query path', async () => {
    const stale = record('stale');
    const fresh = record('fresh');
    const expected = { record: fresh, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValue(fresh);

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: stale,
        diff: {} as CensusImportDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord,
        createId: () => 'id',
      })
    ).resolves.toBe(expected);
    expect(getFreshRecord).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh, expect.anything());
  });

  it('rebases twice when the census changes again during confirmation', async () => {
    const stale = record('stale');
    const fresh1 = record('fresh-1');
    const fresh2 = record('fresh-2');
    const expected = { record: fresh2, applied: {}, skipped: [] } as unknown as ApplyResult;
    const conflict = new Error('El censo se actualizó hace un momento.');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(expected);
    const getFreshRecord = vi.fn().mockResolvedValueOnce(fresh1).mockResolvedValueOnce(fresh2);

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: stale,
        diff: {} as CensusImportDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord,
        createId: () => 'id',
      })
    ).resolves.toBe(expected);

    expect(getFreshRecord).toHaveBeenCalledTimes(2);
    expect(applyDiff).toHaveBeenNthCalledWith(2, fresh1, expect.anything());
    expect(applyDiff).toHaveBeenNthCalledWith(3, fresh2, expect.anything());
  });

  it('stops after bounded retries when concurrent writes continue', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const applyDiff = vi.fn().mockRejectedValue(conflict);
    const getFreshRecord = vi
      .fn()
      .mockResolvedValueOnce(record('fresh-1'))
      .mockResolvedValueOnce(record('fresh-2'));

    await expect(
      applyConfirmedRayenImport({
        applyPreviousDays: false,
        base: record('stale'),
        diff: {} as CensusImportDiff,
        dailyRecord: {} as DailyRecordRepositoryPort,
        isAdmin: false,
        ensureRun: vi.fn(),
        applyDiff,
        getFreshRecord,
        createId: () => 'id',
      })
    ).rejects.toBe(conflict);

    expect(applyDiff).toHaveBeenCalledTimes(3);
    expect(getFreshRecord).toHaveBeenCalledTimes(2);
  });
});
