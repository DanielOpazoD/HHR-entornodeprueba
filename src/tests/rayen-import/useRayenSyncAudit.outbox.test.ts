import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

vi.mock('@/services/repositories/repositoryConfig', async original => ({
  ...(await original<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));

beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

it('persists a failed Rayen run after a concurrency retry refreshes the base from IndexedDB', async () => {
  const date = '2026-10-24';
  const oldBase: DailyRecord = {
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated: `${date}T10:00:00.000Z`,
    rayenSyncHistory: [],
  };
  await hospitalDB.dailyRecords.put({
    ...oldBase,
    rayenSyncHistory: [
      {
        id: 'other-run',
        startedAt: `${date}T10:01:00.000Z`,
        by: 'OTRO OPERADOR SINTETICO',
        status: 'complete',
      },
    ],
  });
  let writerBase = oldBase;
  const loadDailyRecord = vi.fn(async () => {
    const fresh = await hospitalDB.dailyRecords.get(date);
    if (!fresh) throw new Error('Synthetic record missing');
    writerBase = fresh;
    return fresh;
  });
  const patchDailyRecord = vi
    .fn<(patch: DailyRecordPatch) => Promise<unknown>>()
    .mockRejectedValueOnce(new ConcurrencyError('Conflicto sintetico de otra corrida'))
    .mockImplementation(patch => updatePartialDetailed(date, patch, { baseRecord: writerBase }));
  const { result } = renderHook(() =>
    useRayenSyncAudit({
      currentRecordRef: { current: oldBase },
      patchDailyRecord,
      loadDailyRecord,
      actor: 'OPERADOR SINTETICO',
      createId: () => 'retried-run',
      now: () => new Date(`${date}T11:00:00.000Z`),
    })
  );
  act(() => result.current.startRun());
  await act(async () => result.current.failRun('snapshot_error'));

  expect(loadDailyRecord).toHaveBeenCalledWith(date);
  expect(patchDailyRecord).toHaveBeenCalledTimes(2);
  const stored = await hospitalDB.dailyRecords.get(date);
  expect(stored?.rayenSyncHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'other-run', status: 'complete' }),
      expect.objectContaining({ id: 'retried-run', status: 'failed' }),
    ])
  );
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks).toHaveLength(1);
  expect((tasks[0].payload as DailyRecord).rayenSyncHistory).toEqual(stored?.rayenSyncHistory);
});
