import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  getPreviousDayRecord: vi.fn(),
  getAllDates: vi.fn(),
}));

const paths = [
  '@/services/repositories/dailyRecordRemoteLoader',
  '@/services/storage/firestore/firestoreRecordQueries',
];
const resetLoaders = () => {
  vi.resetModules();
  paths.forEach(path => vi.doUnmock(path));
};

describe('daily record remote module recovery', () => {
  beforeEach(resetLoaders);
  afterEach(resetLoaders);

  it('reads server authority on the next explicit call after a loader failure', async () => {
    vi.doMock(paths[0], () => {
      throw new Error('module unavailable');
    });
    const reader = await import('@/services/repositories/dailyRecordRepositoryReadService');
    await expect(reader.getAuthoritativeForDate('2026-04-10')).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'module unavailable' }),
    });

    const record = { date: '2026-04-10', beds: {} };
    const loadRemoteRecordWithFallback = vi.fn().mockResolvedValue({ record });
    vi.doMock(paths[0], () => ({ loadRemoteRecordWithFallback }));
    await expect(reader.getAuthoritativeForDate('2026-04-10')).resolves.toBe(record);
    expect(loadRemoteRecordWithFallback).toHaveBeenCalledExactlyOnceWith('2026-04-10', {
      source: 'server',
    });
  });

  it('can query the requested month on a later call after its module becomes available', async () => {
    vi.doMock(paths[1], () => {
      throw new Error('module unavailable');
    });
    const reader = await import('@/services/repositories/dailyRecordRepositoryReadService');
    await expect(reader.getMonthRecords(2026, 3)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'module unavailable' }),
    });

    const records = [{ date: '2026-04-10' }];
    const getMonthRecordsFromFirestore = vi.fn().mockResolvedValue(records);
    vi.doMock(paths[1], () => ({ getMonthRecordsFromFirestore }));
    await expect(reader.getMonthRecords(2026, 3)).resolves.toBe(records);
    expect(getMonthRecordsFromFirestore).toHaveBeenCalledExactlyOnceWith(2026, 3);
  });
});
