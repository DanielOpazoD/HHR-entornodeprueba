import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { useRayenSyncRecordAccess } from '@/features/rayen-import/hooks/useRayenSyncRecordAccess';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import {
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import {
  createDailyRecordQueryResult,
  createDailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

vi.mock('@/services/repositories/repositoryConfig', async original => ({
  ...(await original<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => false,
}));

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const date = '2026-10-25';
const event = (id: string, status: RayenSyncEvent['status'] = 'applied'): RayenSyncEvent => ({
  id,
  sourceDate: date,
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
const queryResult = (value: DailyRecord | null) =>
  createDailyRecordQueryResult(value, {
    serverConfirmed: false,
    date,
    availabilityState: 'resolved',
    consistencyState: 'local_only',
    sourceOfTruth: 'local',
    retryability: 'not_applicable',
    recoveryAction: 'none',
    conflictSummary: null,
    observabilityTags: [],
    repairApplied: false,
  });

const mountTab = (cache: DailyRecord, visible: DailyRecord, runId = 'R2') => {
  const dailyRecord = {
    ...buildMockDailyRecordRepository(),
    updatePartialDetailed: vi.fn(updatePartialDetailed),
    getForDateWithMeta: vi.fn(async () =>
      createDailyRecordReadResult(
        date,
        (await hospitalDB.dailyRecords.get(date)) ?? null,
        'indexeddb'
      )
    ),
  };
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(getDailyRecordQueryKey(date), queryResult(cache));
  const repositories = createRepositoryContainer({ dailyRecord });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repositories}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  const currentRecordRef = { current: visible };
  const hook = renderHook(
    () => {
      const mutation = usePatchDailyRecordMutation(date);
      const { loadFreshClinicalRecord } = useRayenSyncRecordAccess(dailyRecord);
      const audit = useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord: mutation.mutateAsync,
        loadDailyRecord: loadFreshClinicalRecord,
        actor: 'OPERADOR SINTETICO',
        createId: () => runId,
        now: () => new Date(`${date}T12:00:00.000Z`),
      });
      return { audit, mutation };
    },
    { wrapper }
  );
  act(() => hook.result.current.audit.startRun());
  return { hook, dailyRecord, queryClient };
};

const readPersisted = async () => {
  const stored = await hospitalDB.dailyRecords.get(date);
  const tasks = await hospitalDB.syncQueue.toArray();
  expect(tasks).toHaveLength(1);
  expect(tasks[0].payload).toMatchObject({ rayenSyncHistory: stored?.rayenSyncHistory });
  return stored;
};

beforeEach(async () => {
  resetDailyRecordFreshnessGateForTests();
  clearPendingDailyRecordPatchesForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  clearPendingDailyRecordPatchesForTests();
});

describe('Rayen audit through the query mutation and durable outbox', () => {
  for (const status of ['failed', 'complete', 'partial'] as const) {
    for (const operation of ['failRun', 'completeRun'] as const) {
      it(`${operation} keeps another run ${status} when the cache advances before the visible record`, async () => {
        const stale = record([event('R2'), event('R1')]);
        const fresh = record([event('R2'), event('R1', status)]);
        await hospitalDB.dailyRecords.put(fresh);
        const { hook } = mountTab(fresh, stale);

        await act(async () => {
          if (operation === 'failRun') await hook.result.current.audit.failRun('snapshot_error');
          else
            await hook.result.current.audit.completeRun(
              stale,
              { total: 0, patched: 0, errors: [] },
              null,
              'R2'
            );
        });

        expect((await readPersisted())?.rayenSyncHistory).toEqual(
          expect.arrayContaining([
            event('R1', status),
            expect.objectContaining({
              id: 'R2',
              status: operation === 'failRun' ? 'failed' : 'complete',
            }),
          ])
        );
      });
    }
  }

  it('completes after a same-run conflict even though the fresh repository read does not update the query cache', async () => {
    const stale = record([event('R2'), event('R1')]);
    await hospitalDB.dailyRecords.put(stale);
    await updatePartialDetailed(
      date,
      { rayenSyncHistory: [event('R2', 'partial'), event('R1', 'failed')] },
      { baseRecord: stale }
    );
    const { hook, dailyRecord } = mountTab(stale, stale);

    await act(async () => {
      await hook.result.current.audit.completeRun(
        stale,
        { total: 0, patched: 0, errors: [] },
        null,
        'R2'
      );
    });

    expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledTimes(1);
    expect((await readPersisted())?.rayenSyncHistory).toEqual(
      expect.arrayContaining([
        event('R1', 'failed'),
        expect.objectContaining({ id: 'R2', status: 'complete' }),
      ])
    );
  });

  it('keeps another terminal run when the online freshness check advances the cache', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const stale = record([event('R1')]);
    const fresh = { ...record([event('R1', 'complete')]), lastUpdated: `${date}T11:30:00.000Z` };
    await hospitalDB.dailyRecords.put(fresh);
    const { hook, dailyRecord } = mountTab(stale, stale);
    dailyRecord.getForDateWithMeta.mockResolvedValue(
      createDailyRecordReadResult(date, fresh, 'firestore', { serverConfirmed: true })
    );
    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);

    await act(async () => {
      await hook.result.current.audit.failRun('snapshot_error');
    });

    expect(dailyRecord.getForDateWithMeta).toHaveBeenCalled();
    expect((await readPersisted())?.rayenSyncHistory).toEqual(
      expect.arrayContaining([
        event('R1', 'complete'),
        expect.objectContaining({ id: 'R2', status: 'failed' }),
      ])
    );
  });

  it('retains the stored history and pending task when the conflict recovery read fails', async () => {
    const stale = record([event('R2')]);
    await hospitalDB.dailyRecords.put(stale);
    await updatePartialDetailed(
      date,
      { rayenSyncHistory: [event('R2', 'partial')] },
      { baseRecord: stale }
    );
    const before = await hospitalDB.syncQueue.toArray();
    const { hook, dailyRecord } = mountTab(stale, stale);
    dailyRecord.getForDateWithMeta.mockRejectedValue(new Error('LECTURA SINTETICA FALLIDA'));

    await act(async () => {
      await expect(
        hook.result.current.audit.completeRun(
          stale,
          { total: 0, patched: 0, errors: [] },
          null,
          'R2'
        )
      ).rejects.toThrow('LECTURA SINTETICA FALLIDA');
    });

    expect((await readPersisted())?.rayenSyncHistory).toEqual([event('R2', 'partial')]);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
  });

  it('keeps both runs from two independent query caches sharing the same old base', async () => {
    const base = record([event('R1', 'complete')]);
    await hospitalDB.dailyRecords.put(base);
    const a = mountTab(base, base, 'RA');
    const b = mountTab(base, base, 'RB');

    await act(async () => {
      await Promise.all([
        a.hook.result.current.audit.failRun('snapshot_error'),
        b.hook.result.current.audit.failRun('snapshot_error'),
      ]);
    });

    expect((await readPersisted())?.rayenSyncHistory).toEqual(
      expect.arrayContaining([
        event('R1', 'complete'),
        expect.objectContaining({ id: 'RA', status: 'failed' }),
        expect.objectContaining({ id: 'RB', status: 'failed' }),
      ])
    );
    expect((await readPersisted())?.rayenSyncHistory).toHaveLength(3);
  });

  it('keeps the original writer base while waiting for a prior census mutation', async () => {
    const stale = record([event('R1')]);
    await hospitalDB.dailyRecords.put(stale);
    const { hook, dailyRecord, queryClient } = mountTab(stale, stale);
    const entered = deferred();
    const release = deferred();
    dailyRecord.updatePartialDetailed.mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return updatePartialDetailed(...args);
    });
    let edit: Promise<unknown> = Promise.resolve();
    let failure: Promise<void> = Promise.resolve();
    await act(async () => {
      edit = hook.result.current.mutation.mutateAsync({
        handoffNovedadesDayShift: 'NOVEDAD SINTETICA',
      });
      await entered.promise;
      failure = hook.result.current.audit.failRun('snapshot_error');
    });
    try {
      await updatePartialDetailed(
        date,
        { rayenSyncHistory: [event('R1', 'complete')] },
        { baseRecord: stale }
      );
      queryClient.setQueryData(
        getDailyRecordQueryKey(date),
        queryResult((await hospitalDB.dailyRecords.get(date)) ?? null)
      );
    } finally {
      release.resolve();
    }
    await act(async () => {
      await edit;
      await failure;
    });

    expect(await readPersisted()).toMatchObject({
      handoffNovedadesDayShift: 'NOVEDAD SINTETICA',
      rayenSyncHistory: expect.arrayContaining([
        event('R1', 'complete'),
        expect.objectContaining({ id: 'R2', status: 'failed' }),
      ]),
    });
  });
});
