import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

const { callable, remoteRead } = vi.hoisted(() => ({ callable: vi.fn(), remoteRead: vi.fn() }));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: remoteRead,
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-doc' }),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'enforced',
  isServerClinicalWriteFenceActive: async () => true,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: callable,
}));

const date = '2026-11-01';
const base = `${date}T10:00:00.000Z`;
const local = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T10:01:00.000Z`,
    handoffNovedadesDayShift: 'SYNTHETIC A NOTE',
    nurseName: 'UNRELATED OLD VALUE',
  });
const remote = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: base,
    handoffNovedadesDayShift: '',
    nurseName: 'SYNTHETIC REMOTE',
  });
const held = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  opId: 'synthetic-held',
  ownerKey: 'user:synthetic-A',
  payload: local(),
  status: 'PENDING',
  nursingHandoffRecovery: true,
  projectionReleased: true,
  timestamp: 1,
  retryCount: 0,
  syncContract: {
    changedPaths: ['handoffNovedadesDayShift'],
    expectedVersion: base,
    mutationId: 'original-A',
  },
  ...overrides,
});
const engine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    transport: createFirestoreSyncTransport(),
    runtime: { isOnline: () => true, getOwnerKey: () => 'user:synthetic-A', onOnline: () => {} },
    batchSize: 1,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });
const read = (record: DailyRecord, meta: Record<string, unknown> = {}) =>
  remoteRead.mockResolvedValue({ exists: () => true, data: () => ({ ...record, meta }) });

beforeEach(async () => {
  vi.clearAllMocks();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  read(remote());
  callable.mockImplementation(async ({ record }: { record: DailyRecord }) => ({
    recordState: { record, lastUpdated: record.lastUpdated, meta: {} },
  }));
});
afterEach(() => vi.restoreAllMocks());

it('replays only nursing paths with A version and mutation identity, preserving remote fields', async () => {
  await hospitalDB.syncQueue.add(held());
  await engine().processQueue();
  expect(callable).toHaveBeenCalledOnce();
  expect(callable.mock.calls[0][0]).toMatchObject({
    expectedLastUpdated: base,
    record: { handoffNovedadesDayShift: 'SYNTHETIC A NOTE', nurseName: 'SYNTHETIC REMOTE' },
    syncContract: {
      changedPaths: ['handoffNovedadesDayShift'],
      expectedVersion: base,
      mutationId: 'original-A',
    },
  });
  expect(await hospitalDB.syncQueue.count()).toBe(0);
  expect(await hospitalDB.dailyRecords.get(date)).toMatchObject({
    nurseName: 'SYNTHETIC REMOTE',
    handoffNovedadesDayShift: 'SYNTHETIC A NOTE',
  });
});

it('confirms the nursing subset of mixed work while keeping the other edit and original payload held', async () => {
  const original = held({
    syncContract: {
      ...held().syncContract,
      changedPaths: ['handoffNovedadesDayShift', 'nurseName'],
    },
  });
  const id = await hospitalDB.syncQueue.add(original);
  await engine().processQueue();
  expect(callable.mock.calls[0][0].record.nurseName).toBe('SYNTHETIC REMOTE');
  expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
    status: 'FAILED',
    lastErrorCode: 'session_owner_logged_out',
    projectionReleased: true,
    ownerKey: 'user:synthetic-A',
    payload: original.payload,
    syncContract: { ...original.syncContract, changedPaths: ['nurseName'] },
  });
  expect((await hospitalDB.syncQueue.get(id))?.nursingHandoffRecovery).toBeUndefined();
});

it.each(['newer time', 'same time newer revision', 'unknown base', 'missing remote'])(
  'retains the original handoff for review without writing on %s',
  async situation => {
    let task = held();
    if (situation === 'newer time') read({ ...remote(), lastUpdated: `${date}T10:02:00.000Z` });
    if (situation === 'same time newer revision') {
      read(remote(), { revision: 5 });
      task = held({ syncContract: { ...held().syncContract, baseRevision: 4 } });
    }
    if (situation === 'unknown base')
      task = held({ syncContract: { changedPaths: ['handoffNovedadesDayShift'] } });
    if (situation === 'missing remote') remoteRead.mockResolvedValue({ exists: () => false });
    await hospitalDB.syncQueue.add(task);
    await engine().processQueue();
    expect(callable).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([
      expect.objectContaining({
        status: 'CONFLICT',
        payload: task.payload,
        ownerKey: 'user:synthetic-A',
      }),
    ]);
  }
);

it.each([false, true])(
  'acknowledges a previously committed recovery without resending after a lost ACK (mixed=%s)',
  async mixed => {
    read(
      {
        ...remote(),
        lastUpdated: `${date}T10:03:00.000Z`,
        handoffNovedadesDayShift: 'SYNTHETIC A NOTE',
      },
      { lastMutationId: mixed ? 'original-A:nursing-recovery' : 'original-A' }
    );
    await hospitalDB.syncQueue.add(
      held({
        syncContract: {
          ...held().syncContract,
          changedPaths: mixed
            ? ['handoffNovedadesDayShift', 'nurseName']
            : ['handoffNovedadesDayShift'],
        },
      })
    );
    await engine().processQueue();
    expect(callable).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.count()).toBe(mixed ? 1 : 0);
  }
);

it('does not acknowledge a compacted nursing send until all its declared values were applied', async () => {
  read({ ...remote(), lastUpdated: `${date}T10:03:00.000Z` }, { lastMutationId: 'original-A' });
  await hospitalDB.syncQueue.add(
    held({ syncContract: { ...held().syncContract, mutationIds: ['earlier-A', 'original-A'] } })
  );
  await engine().processQueue();
  expect(callable).not.toHaveBeenCalled();
  expect(await hospitalDB.syncQueue.toArray()).toEqual([
    expect.objectContaining({ status: 'CONFLICT', payload: local() }),
  ]);
});

it('never gives a retained nursing note to a different patient occupying the same bed', async () => {
  const previous = DataFactory.createMockPatient('R1', {
    patientName: 'Synthetic Previous',
    clinicalEpisodeId: 'old-episode',
    handoffNoteDayShift: 'PRIVATE OLD NOTE',
  });
  const current = DataFactory.createMockPatient('R1', {
    patientName: 'Synthetic Current',
    rut: '11.111.111-1',
    clinicalEpisodeId: 'new-episode',
    handoffNoteDayShift: 'CURRENT NOTE',
  });
  read({ ...remote(), beds: { R1: current } });
  await hospitalDB.syncQueue.add(
    held({
      payload: { ...local(), beds: { R1: previous } },
      syncContract: { ...held().syncContract, changedPaths: ['beds.R1.handoffNoteDayShift'] },
    })
  );
  await engine().processQueue();
  expect(callable).not.toHaveBeenCalled();
  expect(await hospitalDB.syncQueue.toArray()).toEqual([
    expect.objectContaining({
      status: 'CONFLICT',
      ownerKey: 'user:synthetic-A',
      syncContract: expect.objectContaining({ changedPaths: ['beds.R1.handoffNoteDayShift'] }),
    }),
  ]);
  expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.handoffNoteDayShift).toBe(
    'CURRENT NOTE'
  );
});
