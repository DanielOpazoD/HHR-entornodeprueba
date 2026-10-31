import { readDailyRecordQuery } from '@/tests/utils/readDailyRecordQuery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  getAuthoritativeForDate,
  getForDateWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import {
  createDailyRecordQueryOptions,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  ensureDailyRecordRemoteFreshness,
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import {
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  getRemote: vi.fn(),
  getLocal: vi.fn(),
  save: vi.fn(async () => ({ ok: true, operation: 'save', store: 'indexeddb', dates: [] })),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: mocks.getLocal,
  captureLocalRecordBase: async () => ({ kind: 'stored', record: await mocks.getLocal() }),
  inspectLocalRecordAdmission: async () => ({ status: 'admitted' }),
  saveRecord: vi.fn(),
  saveRecordStrict: mocks.save,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: mocks.subscribe,
  getRecordFromFirestoreDetailed: mocks.getRemote,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
const date = '2026-10-27';
const createRecord = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    nurses: ['Turno A', 'Turno B'],
    nursesDayShift: ['Turno A', 'Turno B'],
    nursesNightShift: ['Turno C', 'Turno D'],
  });
const cleanups: Array<() => void> = [];

const openSubscription = () => {
  const client = new QueryClient();
  let sdkEmit: Parameters<typeof subscribeToRecord>[1] = () => {
    throw new Error('Subscription not installed');
  };
  let delivered = () => {};
  mocks.subscribe.mockImplementation((_date, callback) => {
    sdkEmit = callback;
    return () => {};
  });
  const stop = createDailyRecordSubscription(
    {
      getForDateWithMeta: vi.fn(),
      subscribeDetailed: (requestedDate, callback) =>
        subscribeDetailed(requestedDate, (result, pending) => {
          callback(result, pending);
          delivered();
        }),
    },
    date,
    client
  );
  cleanups.push(() => {
    stop?.();
    client.clear();
  });
  return {
    read: () => client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date)),
    emit: (...args: Parameters<typeof sdkEmit>) =>
      new Promise<void>(resolve => {
        delivered = resolve;
        sdkEmit(...args);
      }),
  };
};

beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  mocks.getLocal.mockReset().mockResolvedValue(null);
  mocks.subscribe.mockReset();
  mocks.getRemote.mockReset();
  clearPendingDailyRecordPatchesForTests();
  resetDailyRecordFreshnessGateForTests();
  markDailyRecordTabHidden(0);
  markDailyRecordTabVisible(6 * 60 * 1000);
  expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
});

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  resetDailyRecordFreshnessGateForTests();
});

describe('daily record server confirmation through repository and query', () => {
  it.each([false, true])(
    'does not carry a previous patient diagnosis across repeated snapshots: confirmed %s',
    async serverConfirmed => {
      const previous = DataFactory.createMockDailyRecord(date);
      previous.lastUpdated = '2026-10-27T12:00:00.000Z';
      previous.beds.R1.clinicalEpisodeId = 'ep_previous_synthetic';
      previous.beds.R1.patientName = 'Paciente sintético anterior';
      previous.beds.R1.rut = '11.111.111-1';
      const replacement = structuredClone(previous);
      replacement.lastUpdated = '2026-10-27T13:00:00.000Z';
      replacement.beds.R1.clinicalEpisodeId = 'ep_replacement_synthetic';
      replacement.beds.R1.patientName = 'Paciente sintético siguiente';
      replacement.beds.R1.rut = '22.222.222-2';
      const subscription = openSubscription();
      const metadata = { fromCache: !serverConfirmed, hasPendingWrites: false };
      await subscription.emit(previous, false, { fromCache: true, hasPendingWrites: false });
      const release = registerPendingDailyRecordPatch(date, { 'beds.R1.pathology': 'Pending A' });
      cleanups.push(release);
      await subscription.emit(previous, false, { fromCache: true, hasPendingWrites: false });
      expect(subscription.read()?.record?.beds.R1.pathology).toBe('Pending A');
      await subscription.emit(replacement, false, metadata);
      await subscription.emit(replacement, false, metadata);
      const patient = subscription.read()?.record?.beds.R1;
      if (serverConfirmed) expect(patient?.clinicalEpisodeId).toBe('ep_replacement_synthetic');
      expect(patient?.pathology).toBe(
        patient?.clinicalEpisodeId === 'ep_previous_synthetic' ? 'Pending A' : ''
      );
      if (!serverConfirmed) {
        await subscription.emit(
          { ...previous, lastUpdated: '2026-10-27T14:00:00.000Z' },
          false,
          metadata
        );
        expect(subscription.read()?.record?.beds.R1.pathology).toBe('Pending A');
        expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
      }
    }
  );

  it.each([
    { fromCache: true, hasPendingWrites: false, confirmed: false },
    { fromCache: true, hasPendingWrites: true, confirmed: false },
    { fromCache: false, hasPendingWrites: false, confirmed: true },
    { fromCache: false, hasPendingWrites: true, confirmed: false },
  ])(
    'only confirms server data without pending writes: $fromCache / $hasPendingWrites',
    async ({ fromCache, hasPendingWrites, confirmed }) => {
      const subscription = openSubscription();
      const record = createRecord();
      await subscription.emit(record, hasPendingWrites, { fromCache, hasPendingWrites });
      expect(getDailyRecordFreshnessStatus(date)).toBe(
        confirmed ? 'fresh_remote_confirmed' : 'stale_due_to_inactivity'
      );
      if (!hasPendingWrites) expect(subscription.read()?.record).toMatchObject(record);
    }
  );

  it('confirms a metadata-only transition from cache to server', async () => {
    const subscription = openSubscription();
    const record = createRecord();
    await subscription.emit(record, false, { fromCache: true, hasPendingWrites: false });
    expect(subscription.read()?.record).toMatchObject(record);
    expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');

    await subscription.emit(record, false, { fromCache: false, hasPendingWrites: false });
    expect(subscription.read()?.record).toMatchObject(record);
    expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');
  });

  it('does not infer a server confirmation when metadata is absent', async () => {
    const subscription = openSubscription();
    const record = createRecord();
    await subscription.emit(record, false);
    expect(subscription.read()?.record).toMatchObject(record);
    expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
  });

  it('retains the local census when the cache has no document', async () => {
    const record = createRecord();
    mocks.getLocal.mockResolvedValue(record);
    const subscription = openSubscription();
    await subscription.emit(null, false, { fromCache: true, hasPendingWrites: false });
    expect(subscription.read()?.record).toMatchObject(record);
    expect(subscription.read()?.runtime.availabilityState).not.toBe('confirmed_missing');
    expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
  });

  it('keeps an explicit patch through cached echoes until the server confirms it', async () => {
    const record = DataFactory.createMockDailyRecord(date);
    record.beds.R1.clinicalEpisodeId = 'ep_synthetic_confirmation';
    record.beds.R1.pathology = 'Initial diagnosis';
    const subscription = openSubscription();
    await subscription.emit(record, false, { fromCache: true, hasPendingWrites: false });
    const release = registerPendingDailyRecordPatch(date, {
      'beds.R1.pathology': 'Accepted diagnosis',
    });
    cleanups.push(release);
    const echo = structuredClone(record);
    echo.beds.R1.pathology = 'Accepted diagnosis';
    await subscription.emit(echo, false, { fromCache: true, hasPendingWrites: false });
    await subscription.emit(record, false, { fromCache: true, hasPendingWrites: false });
    expect(subscription.read()?.record?.beds.R1.pathology).toBe('Accepted diagnosis');

    await subscription.emit(echo, false, { fromCache: false, hasPendingWrites: false });
    const next = structuredClone(record);
    next.lastUpdated = '2026-10-27T12:00:00.000Z';
    next.beds.R1.pathology = 'Later server diagnosis';
    await subscription.emit(next, false, { fromCache: false, hasPendingWrites: false });
    expect(subscription.read()?.record?.beds.R1.pathology).toBe('Later server diagnosis');
  });

  it.each([false, true])(
    'requires server evidence in ordinary refetch: %s',
    async serverConfirmed => {
      mocks.getRemote.mockResolvedValue({
        status: 'resolved',
        record: createRecord(),
        serverConfirmed,
      });
      const client = new QueryClient();
      cleanups.push(() => client.clear());
      const refresh = ensureDailyRecordRemoteFreshness({
        date,
        queryClient: client,
        ...createDailyRecordQueryOptions({ getForDateWithMeta }, date, client),
        reason: 'resume',
      });
      if (serverConfirmed) {
        await refresh;
        expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');
      } else {
        await expect(refresh).rejects.toThrow();
        expect(getDailyRecordFreshnessStatus(date)).toBe('blocked_until_remote_check');
      }
      expect(
        client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record?.date
      ).toBe(date);
    }
  );

  it('does not recycle a previous server confirmation when an older cache read is retained', async () => {
    const client = new QueryClient();
    cleanups.push(() => client.clear());
    const current = createRecord();
    current.lastUpdated = '2026-10-27T13:00:00.000Z';
    mocks.getRemote.mockResolvedValueOnce({
      status: 'resolved',
      record: current,
      serverConfirmed: true,
    });
    client.setQueryData(
      getDailyRecordQueryKey(date),
      await readDailyRecordQuery({ getForDateWithMeta }, date)
    );
    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);
    mocks.getRemote.mockResolvedValueOnce({
      status: 'resolved',
      record: createRecord(),
      serverConfirmed: false,
    });
    await expect(
      ensureDailyRecordRemoteFreshness({
        date,
        queryClient: client,
        ...createDailyRecordQueryOptions({ getForDateWithMeta }, date, client),
        reason: 'resume',
      })
    ).rejects.toThrow();
    expect(
      client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record?.lastUpdated
    ).toBe(current.lastUpdated);
    expect(getDailyRecordFreshnessStatus(date)).toBe('blocked_until_remote_check');
  });

  it.each([false, true])(
    'only confirms absence with server evidence: %s',
    async serverConfirmed => {
      mocks.getRemote.mockResolvedValue({ status: 'missing', record: null, serverConfirmed });
      const result = await readDailyRecordQuery({ getForDateWithMeta }, date);
      expect(result.record).toBeNull();
      if (serverConfirmed) expect(result.runtime.availabilityState).toBe('confirmed_missing');
      else expect(result.runtime.availabilityState).not.toBe('confirmed_missing');
    }
  );

  it('propagates the SDK rejection of a server-only read without proof', async () => {
    mocks.getRemote.mockResolvedValue({
      status: 'failed',
      record: null,
      serverConfirmed: false,
      error: new Error('Server confirmation unavailable'),
    });
    await expect(getAuthoritativeForDate(date)).rejects.toThrow();
  });

  it.each(['cancel', 'clear'] as const)(
    'does not renew freshness when a read finishes after query %s',
    async action => {
      const client = new QueryClient();
      cleanups.push(() => client.clear());
      let finishRead!: () => void;
      const readFinished = new Promise<void>(resolve => {
        finishRead = resolve;
      });
      let deliverRemote!: (value: {
        status: 'resolved';
        serverConfirmed: true;
        record: ReturnType<typeof createRecord>;
      }) => void;
      mocks.getRemote.mockReturnValue(
        new Promise(resolve => {
          deliverRemote = resolve;
        })
      );
      const queryFn = createDailyRecordQueryOptions({ getForDateWithMeta }, date, client).queryFn;
      const query = client.fetchQuery({
        queryKey: getDailyRecordQueryKey(date),
        queryFn: async (...args: Parameters<typeof queryFn>) => {
          try {
            return await queryFn(...args);
          } finally {
            finishRead();
          }
        },
      });
      const rejected = expect(query).rejects.toBeDefined();
      await vi.waitFor(() => expect(mocks.getRemote).toHaveBeenCalledOnce());
      if (action === 'cancel') await client.cancelQueries();
      else client.clear();
      deliverRemote({ status: 'resolved', serverConfirmed: true, record: createRecord() });
      await readFinished;
      await rejected;

      expect(client.getQueryData(getDailyRecordQueryKey(date))).toBeUndefined();
      expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
    }
  );
});
