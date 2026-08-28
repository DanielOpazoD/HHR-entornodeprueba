import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestoreDetailed: vi.fn(),
}));

import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore/firestoreRecordQueries';

describe('dailyRecordRemoteLoader', () => {
  const date = '2025-01-01';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns firestore metadata when the primary remote record exists', async () => {
    vi.mocked(getRecordFromFirestoreDetailed).mockResolvedValue({
      status: 'resolved',
      record: DataFactory.createMockDailyRecord(date, { schemaVersion: 1 }),
    });

    const result = await loadRemoteRecordWithFallback(date);

    expect(result.source).toBe('firestore');
    expect(result.compatibilityTier).toBe('current_firestore');
    expect(result.compatibilityIntensity).toBe('normalized_only');
    expect(result.cachedLocally).toBe(false);
    expect(result.migrationRulesApplied).toContain('schema_defaults_applied');
  });

  it('returns not_found metadata when neither remote source has data', async () => {
    vi.mocked(getRecordFromFirestoreDetailed).mockResolvedValue({
      status: 'missing',
      record: null,
    });

    const result = await loadRemoteRecordWithFallback(date);

    expect(result.record).toBeNull();
    expect(result.source).toBe('not_found');
    expect(result.compatibilityTier).toBe('none');
    expect(result.compatibilityIntensity).toBe('none');
    expect(result.cachedLocally).toBe(false);
    expect(result.migrationRulesApplied).toEqual([]);
  });

  it('deduplicates concurrent remote loads for the same date', async () => {
    let resolveRemote:
      | ((value: {
          status: 'resolved';
          record: ReturnType<typeof DataFactory.createMockDailyRecord>;
        }) => void)
      | undefined;

    vi.mocked(getRecordFromFirestoreDetailed).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRemote = resolve;
        })
    );

    const firstCall = loadRemoteRecordWithFallback(date);
    const secondCall = loadRemoteRecordWithFallback(date);

    if (!resolveRemote) {
      throw new Error('Remote resolver was not captured');
    }

    resolveRemote({
      status: 'resolved',
      record: DataFactory.createMockDailyRecord(date),
    });
    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);

    expect(getRecordFromFirestoreDetailed).toHaveBeenCalledTimes(1);
    expect(firstResult.record?.date).toBe(date);
    expect(secondResult.record?.date).toBe(date);
  });

  it('does not let a cached read satisfy a concurrent server-authoritative read', async () => {
    const resolvers: Array<
      (value: {
        status: 'resolved';
        record: ReturnType<typeof DataFactory.createMockDailyRecord>;
      }) => void
    > = [];
    vi.mocked(getRecordFromFirestoreDetailed).mockImplementation(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve);
        })
    );

    const cachedRead = loadRemoteRecordWithFallback(date);
    const serverRead = loadRemoteRecordWithFallback(date, { source: 'server' });

    expect(getRecordFromFirestoreDetailed).toHaveBeenCalledTimes(2);
    expect(getRecordFromFirestoreDetailed).toHaveBeenNthCalledWith(1, date, {
      source: 'default',
    });
    expect(getRecordFromFirestoreDetailed).toHaveBeenNthCalledWith(2, date, {
      source: 'server',
    });
    resolvers.forEach(resolve =>
      resolve({ status: 'resolved', record: DataFactory.createMockDailyRecord(date) })
    );

    await expect(Promise.all([cachedRead, serverRead])).resolves.toHaveLength(2);
  });

  it('does not consult legacy storage in the hot path anymore', async () => {
    vi.mocked(getRecordFromFirestoreDetailed).mockResolvedValue({
      status: 'missing',
      record: null,
    });

    const result = await loadRemoteRecordWithFallback(date);

    expect(result.source).toBe('not_found');
    expect(result.cachedLocally).toBe(false);
  });

  it('propagates failed remote reads so the repository can mark them unavailable', async () => {
    vi.mocked(getRecordFromFirestoreDetailed).mockResolvedValue({
      status: 'failed',
      record: null,
      error: new Error('permission-denied'),
    });

    await expect(loadRemoteRecordWithFallback(date)).rejects.toThrow('permission-denied');
  });
});
