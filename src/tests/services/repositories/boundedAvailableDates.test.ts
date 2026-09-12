import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllDates: vi.fn(async () => ['2026-09-01']),
  localPrevious: vi.fn(async (_d: string) => null),
  allRemote: vi.fn(async () => ['2026-09-11']),
  recentRemote: vi.fn(async (_ref: string) => ['2026-09-11', '2026-09-10']),
  previousDate: vi.fn(async (_d: string): Promise<string | null> => '2026-09-10'),
  isFirestoreEnabled: vi.fn(() => true),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', async o => ({
  ...(await o<object>()),
  getAllDates: mocks.getAllDates,
  getPreviousDayRecord: mocks.localPrevious,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async o => ({
  ...(await o<object>()),
  getAvailableDatesFromFirestore: mocks.allRemote,
  getRecentAvailableDatesFromFirestore: mocks.recentRemote,
  getPreviousRecordDateFromFirestore: mocks.previousDate,
}));
vi.mock('@/services/repositories/repositoryConfig', async o => ({
  ...(await o<object>()),
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));

const load = () => import('@/services/repositories/dailyRecordRepositoryReadService');

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

describe('bounded startup reads of census history', () => {
  it('never downloads the whole history for the startup prompt', async () => {
    const { getRecentAvailableDates } = await load();
    const dates = await getRecentAvailableDates('2026-09-11');
    expect(mocks.allRemote).not.toHaveBeenCalled();
    expect(mocks.recentRemote).toHaveBeenCalledWith('2026-09-11');
    expect(dates).toEqual(expect.arrayContaining(['2026-09-11', '2026-09-10', '2026-09-01']));
  });

  it('keeps locally known dates when the bounded remote read fails', async () => {
    mocks.recentRemote.mockRejectedValueOnce(new Error('sin red'));
    const { getRecentAvailableDates } = await load();
    await expect(getRecentAvailableDates('2026-09-11')).resolves.toEqual(['2026-09-01']);
  });

  it('still exposes the full history for migrations that need every date', async () => {
    const { getAvailableDates } = await load();
    await getAvailableDates();
    expect(mocks.allRemote).toHaveBeenCalledTimes(1);
    expect(mocks.recentRemote).not.toHaveBeenCalled();
  });

  it('resolves the previous day with a targeted lookup instead of listing history', async () => {
    const { getPreviousDayWithMeta } = await load();
    await getPreviousDayWithMeta('2026-09-11');
    expect(mocks.previousDate).toHaveBeenCalledWith('2026-09-11');
    expect(mocks.allRemote).not.toHaveBeenCalled();
    expect(mocks.recentRemote).not.toHaveBeenCalled();
  });

  it('reports no previous day instead of guessing when the lookup finds nothing', async () => {
    mocks.previousDate.mockResolvedValueOnce(null);
    const { getPreviousDayWithMeta } = await load();
    const result = await getPreviousDayWithMeta('2026-09-11');
    expect(result.record).toBeNull();
  });
});
