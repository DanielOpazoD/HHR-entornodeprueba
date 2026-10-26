import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

vi.mock('@/services/repositories/repositoryConfig', async original => ({
  ...(await original<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));

const date = '2026-10-24';
const event = (id: string, status: RayenSyncEvent['status'] = 'applied'): RayenSyncEvent => ({
  id,
  startedAt: `${date}T11:00:00.000Z`,
  by: 'OPERADOR SINTETICO',
  status,
});
const record = (history: RayenSyncEvent[]): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  lastUpdated: `${date}T10:00:00.000Z`,
  rayenSyncHistory: history,
});
const write = (baseRecord: DailyRecord, history: RayenSyncEvent[]) =>
  updatePartialDetailed(date, { rayenSyncHistory: history }, { baseRecord });
const readHistory = async () => {
  const stored = await hospitalDB.dailyRecords.get(date);
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks).toHaveLength(1);
  expect(tasks[0].payload).toMatchObject({ rayenSyncHistory: stored?.rayenSyncHistory });
  return stored?.rayenSyncHistory;
};

beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('Rayen history rebase against the writer base', () => {
  for (const status of ['failed', 'complete', 'partial'] as const) {
    for (const pending of [true, false]) {
      it(`keeps ${status} R1 when an unchanged stale R1 accompanies R2 (pending=${pending})`, async () => {
        const base = record([event('R1')]);
        await hospitalDB.dailyRecords.put(base);
        if (pending) await write(base, [event('R1', status)]);
        else await hospitalDB.dailyRecords.put(record([event('R1', status)]));

        expect((await write(base, [event('R2', 'failed'), event('R1')])).savedLocally).toBe(true);
        expect(await readHistory()).toEqual([event('R1', status), event('R2', 'failed')]);
      });
    }
  }

  it('rejects incompatible changes to the same id without changing the projection or outbox', async () => {
    const base = record([event('R1')]);
    await hospitalDB.dailyRecords.put(base);
    await write(base, [event('R1', 'failed')]);
    const before = await hospitalDB.syncQueue.toArray();

    await expect(write(base, [event('R1', 'complete')])).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await readHistory()).toEqual([event('R1', 'failed')]);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
  });

  it('accepts the same change twice and a subsequent update from a fresh base', async () => {
    const base = record([event('R1')]);
    await hospitalDB.dailyRecords.put(base);
    await write(base, [event('R1', 'partial')]);
    await write(base, [event('R1', 'partial')]);
    const fresh = await hospitalDB.dailyRecords.get(date);
    if (!fresh) throw new Error('Missing synthetic record');
    await write(fresh, [event('R1', 'complete')]);
    expect(await readHistory()).toEqual([event('R1', 'complete')]);
  });

  for (const origin of ['partial_update_retry', 'conflict_auto_merge'] as const) {
    it(`refuses an ambiguous same-id ${origin} without a base and retains pending work`, async () => {
      const base = record([event('R1')]);
      await hospitalDB.dailyRecords.put(base);
      await write(base, [event('R1', 'failed')]);
      const before = await hospitalDB.syncQueue.toArray();

      await expect(
        queueDailyRecordSyncTaskWithLocalRecord(record([event('R2', 'failed'), event('R1')]), {
          origin,
          syncContract: { changedPaths: ['rayenSyncHistory'] },
        })
      ).rejects.toBeInstanceOf(ConcurrencyError);
      expect(await readHistory()).toEqual([event('R1', 'failed')]);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    });
  }

  it('merges different ids from a nonempty base, keeps stable ordering and caps at 20', async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      ...event(`old-${index}`, 'complete'),
      startedAt: `${date}T10:${String(index).padStart(2, '0')}:00.000Z`,
    }));
    const base = record(history);
    await hospitalDB.dailyRecords.put(base);
    await Promise.all([
      write(base, [event('R1', 'failed'), ...history]),
      write(base, [event('R2', 'complete'), ...history]),
    ]);
    const stored = await readHistory();
    expect(stored).toHaveLength(20);
    expect(stored?.slice(0, 3)).toEqual([
      event('R1', 'failed'),
      event('R2', 'complete'),
      history[19],
    ]);
    expect(stored?.some(item => item.id === 'old-0')).toBe(false);
  });
});

describe('Rayen terminal hooks with another stale run in their history', () => {
  const renderAudit = (base: DailyRecord) => {
    const loadDailyRecord = vi.fn(async () => {
      const fresh = await hospitalDB.dailyRecords.get(date);
      if (!fresh) throw new Error('Missing synthetic record');
      return fresh;
    });
    const patchDailyRecord: Parameters<typeof useRayenSyncAudit>[0]['patchDailyRecord'] = ({
      partial,
      options,
    }) => updatePartialDetailed(date, partial, options);
    const hook = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef: { current: base },
        patchDailyRecord,
        loadDailyRecord,
        actor: 'OPERADOR SINTETICO',
        createId: () => 'R2',
        now: () => new Date(`${date}T12:00:00.000Z`),
      })
    );
    return { hook, loadDailyRecord };
  };

  for (const status of ['failed', 'complete', 'partial'] as const) {
    for (const operation of ['failRun', 'completeRun'] as const) {
      it(`${operation} keeps the stored ${status} R1 while finishing R2 from a stale base`, async () => {
        const base = record([event('R2'), event('R1')]);
        await hospitalDB.dailyRecords.put(base);
        await write(base, [event('R2'), event('R1', status)]);
        const { hook } = renderAudit(base);
        act(() => hook.result.current.startRun());

        await act(async () => {
          if (operation === 'failRun') await hook.result.current.failRun('snapshot_error');
          else
            await hook.result.current.completeRun(
              base,
              { total: 0, patched: 0, errors: [] },
              null,
              'R2'
            );
        });

        const history = await readHistory();
        expect(history).toContainEqual(event('R1', status));
        expect(history).toContainEqual(
          expect.objectContaining({
            id: 'R2',
            status: operation === 'failRun' ? 'failed' : 'complete',
          })
        );
      });
    }
  }

  it('reloads after a real same-run conflict and completes against the fresh entry', async () => {
    const base = record([event('R2'), event('R1')]);
    await hospitalDB.dailyRecords.put(base);
    await write(base, [event('R2', 'partial'), event('R1', 'failed')]);
    const { hook, loadDailyRecord } = renderAudit(base);
    act(() => hook.result.current.startRun());

    await act(async () => {
      await hook.result.current.completeRun(base, { total: 0, patched: 0, errors: [] }, null, 'R2');
    });

    expect(loadDailyRecord).toHaveBeenCalledTimes(1);
    expect(await readHistory()).toEqual([
      expect.objectContaining({ id: 'R2', status: 'complete' }),
      event('R1', 'failed'),
    ]);
  });
});
