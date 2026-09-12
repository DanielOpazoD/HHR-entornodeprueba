import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllDates: vi.fn(async () => ['2026-09-10']),
  remoteDates: vi.fn(async () => ['2026-09-11']),
  isFirestoreEnabled: vi.fn(() => true),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', async importOriginal => ({
  ...(await importOriginal<object>()),
  getAllDates: mocks.getAllDates,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<object>()),
  getAvailableDatesFromFirestore: mocks.remoteDates,
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<object>()),
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));

const load = async () =>
  (await import('@/services/repositories/dailyRecordRepositoryReadService')).getAvailableDates;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

describe('available dates reading', () => {
  it('collapses concurrent startup callers into a single remote read', async () => {
    const getAvailableDates = await load();
    const [a, b] = await Promise.all([getAvailableDates(), getAvailableDates()]);
    expect(mocks.remoteDates).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toEqual(expect.arrayContaining(['2026-09-11', '2026-09-10']));
  });

  it('does not cache a stale answer for later calls', async () => {
    const getAvailableDates = await load();
    await getAvailableDates();
    await getAvailableDates();
    expect(mocks.remoteDates).toHaveBeenCalledTimes(2);
  });

  it('lets a later call retry after a failed shared read', async () => {
    mocks.remoteDates.mockRejectedValueOnce(new Error('sin red'));
    const getAvailableDates = await load();
    await expect(getAvailableDates()).resolves.toEqual(['2026-09-10']);
    await expect(getAvailableDates()).resolves.toEqual(
      expect.arrayContaining(['2026-09-11', '2026-09-10'])
    );
    expect(mocks.remoteDates).toHaveBeenCalledTimes(2);
  });
});
