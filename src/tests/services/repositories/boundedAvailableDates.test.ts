import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllDates: vi.fn(async () => ['2026-09-01']),
  localPrevious: vi.fn(async (_d: string) => null),
  allRemote: vi.fn(async () => ['2026-09-11']),
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

describe('bounded reads of census history', () => {
  it('still exposes the full history for migrations that need every date', async () => {
    const { getAvailableDates } = await load();
    await getAvailableDates();
    expect(mocks.allRemote).toHaveBeenCalledTimes(1);
  });

  it('resolves the previous day with a targeted lookup instead of listing history', async () => {
    const { getPreviousDayWithMeta } = await load();
    await getPreviousDayWithMeta('2026-09-11');
    expect(mocks.previousDate).toHaveBeenCalledWith('2026-09-11');
    expect(mocks.allRemote).not.toHaveBeenCalled();
  });

  it('reports no previous day instead of guessing when the lookup finds nothing', async () => {
    mocks.previousDate.mockResolvedValueOnce(null);
    const { getPreviousDayWithMeta } = await load();
    const result = await getPreviousDayWithMeta('2026-09-11');
    expect(result.record).toBeNull();
  });

  it('rejects instead of reporting no previous day when the lookup fails', async () => {
    mocks.previousDate.mockRejectedValueOnce(new Error('sin red'));
    const { getPreviousDayWithMeta } = await load();
    await expect(getPreviousDayWithMeta('2026-09-11')).rejects.toThrow('sin red');
  });
});
