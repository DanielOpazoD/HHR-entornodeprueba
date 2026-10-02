// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remoteLoaded: vi.fn(),
  range: vi.fn(),
  month: vi.fn(),
  localRange: vi.fn(),
  all: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordsForMonth: mocks.month,
  getRecordsRange: mocks.localRange,
  getAllRecordsSorted: mocks.all,
  saveRecords: mocks.save,
}));
vi.mock('@/services/storage/firestore', () => {
  mocks.remoteLoaded();
  return { getRecordsRangeFromFirestore: mocks.range };
});
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => {
  mocks.remoteLoaded();
  return { getRecordsRangeFromFirestore: mocks.range };
});

const day = (date: string, name = '') => ({ date, beds: { R1: { patientName: name } } });

describe('record query local/remote boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.save.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads local calendar and history without loading remote storage', async () => {
    const service = await import('@/services/records/recordQueryService');
    const records = [day('2026-04-02', 'Synthetic'), day('2026-04-03', '   ')];
    mocks.month.mockResolvedValue(records);
    mocks.all.mockResolvedValue(records);
    mocks.localRange.mockResolvedValue([...records]);
    expect(await service.fetchRecordsForMonth(2026, 4)).toBe(records);
    expect(await service.fetchExistingDaysInMonth(2026, 4)).toEqual([2]);
    expect(await service.fetchAllRecordsSorted()).toBe(records);
    expect(await service.fetchRecordsRangeSorted('2026-04-01', '2026-04-30')).toEqual([
      records[1],
      records[0],
    ]);
    expect(mocks.month).toHaveBeenCalledWith(2026, 4);
    expect(mocks.remoteLoaded).not.toHaveBeenCalled();
    expect(mocks.range).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('loads remote range reads on explicit synchronization and preserves the saved result', async () => {
    const service = await import('@/services/records/recordQueryService');
    const records = [day('2026-04-02', 'Synthetic')];
    mocks.range.mockResolvedValue(records);
    expect(mocks.remoteLoaded).not.toHaveBeenCalled();
    expect(await service.syncRecordsRange('2026-04-01', '2026-04-30')).toBe(records);
    expect(mocks.remoteLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.range).toHaveBeenCalledWith('2026-04-01', '2026-04-30');
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(records);
  });

  it('does not persist an empty or failed remote response', async () => {
    const service = await import('@/services/records/recordQueryService');
    mocks.range.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('network unavailable'));
    expect(await service.syncRecordsRange('2026-04-01', '2026-04-30')).toEqual([]);
    await expect(service.syncRecordsRange('2026-04-01', '2026-04-30')).rejects.toThrow(
      'network unavailable'
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('propagates a local persistence failure instead of reporting synchronization success', async () => {
    const service = await import('@/services/records/recordQueryService');
    mocks.range.mockResolvedValue([day('2026-04-02')]);
    mocks.save.mockRejectedValue(new Error('local storage unavailable'));
    await expect(service.syncRecordsRange('2026-04-01', '2026-04-30')).rejects.toThrow(
      'local storage unavailable'
    );
  });
});
