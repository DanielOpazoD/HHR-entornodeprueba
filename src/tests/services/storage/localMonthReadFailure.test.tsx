import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@/services/storage/indexeddb/indexedDbCore';
import { getRecordsForMonth } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  fetchExistingDaysInMonth,
  fetchRecordsForMonth,
} from '@/services/records/recordQueryService';
import { generateCensusMasterExcel } from '@/services/exporters/censusMasterExport';
import { useExistingDaysQuery } from '@/hooks/useExistingDaysQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';

const mocks = vi.hoisted(() => ({ saveAs: vi.fn() }));
vi.mock('@/services/storage/firestore', () => ({}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => false }));
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));

const failRead = () =>
  vi.spyOn(core.hospitalDB.dailyRecords, 'where').mockImplementation(() => {
    throw new Error('synthetic IndexedDB read failure');
  });

describe('local monthly read failure reaches decisions', () => {
  beforeEach(async () => {
    await core.ensureDbReady();
    await core.hospitalDB.dailyRecords.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a failed Dexie toArray instead of returning an empty month', async () => {
    vi.spyOn(core.hospitalDB.Collection.prototype, 'toArray').mockRejectedValue(
      new Error('synthetic toArray failure')
    );
    await expect(getRecordsForMonth(2026, 4)).rejects.toThrow('synthetic toArray failure');
  });

  it('keeps a successfully read empty month empty', async () => {
    expect(await getRecordsForMonth(2026, 4)).toEqual([]);
  });

  it('preserves memory fallback filtering and descending order', async () => {
    vi.spyOn(core, 'isDatabaseInFallbackMode').mockReturnValue(true);
    const day = (date: string) => ({
      date,
      beds: {},
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-04-01T12:00:00Z',
      nurses: [],
      activeExtraBeds: [],
    });
    localPersistence.records.save(day('2026-04-02'));
    localPersistence.records.save(day('2026-04-07'));
    localPersistence.records.save(day('2026-05-01'));
    expect((await getRecordsForMonth(2026, 4)).map(record => record.date)).toEqual([
      '2026-04-07',
      '2026-04-02',
    ]);
    expect(await getRecordsForMonth(2026, 6)).toEqual([]);
  });

  it('does not report missing calendar days or an empty monthly facade on failure', async () => {
    failRead();
    await expect(fetchRecordsForMonth(2026, 4)).rejects.toThrow('synthetic');
    await expect(fetchExistingDaysInMonth(2026, 4)).rejects.toThrow('synthetic');
  });

  it('returns the existing export failure outcome without downloading or claiming no data', async () => {
    failRead();
    expect(await generateCensusMasterExcel(2026, 3, 10)).toMatchObject({ outcome: 'failed' });
    expect(mocks.saveAs).not.toHaveBeenCalled();
  });

  it('preserves known calendar markers when a monthly refresh fails', async () => {
    const { queryClient, wrapper } = createQueryClientTestWrapper();
    queryClient.setQueryData(['existingDays', 2026, 3], [7, 14]);
    const { result, unmount } = renderHook(() => useExistingDaysQuery(2026, 3), { wrapper });
    failRead();
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(queryClient.getQueryData(['existingDays', 2026, 3])).toEqual([7, 14]);
    unmount();
    queryClient.clear();
  });
});
