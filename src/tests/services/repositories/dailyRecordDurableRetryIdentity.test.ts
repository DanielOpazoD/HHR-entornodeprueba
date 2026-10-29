import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB, isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import { persistLocalAndAttemptRemoteSync } from '@/services/repositories/dailyRecordRemotePersistenceController';
import { createRemoteWriteState } from '@/services/repositories/dailyRecordWriteState';
import {
  completeDirectDailyRecordSyncTask,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
  releaseDailyRecordPreOutboxHold,
} from '@/services/storage/sync';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { buildDailyRecordSyncContract } from '@/services/storage/sync/syncTaskContractPolicy';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { saveDailyRecordWithClinicalAuthorityCallable } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const boundary = vi.hoisted(() => ({ read: vi.fn(), publish: vi.fn() }));

vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: boundary.read,
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-c1-day' }),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'enforced',
  isServerClinicalWriteFenceActive: async () => false,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: boundary.publish,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => true,
}));

const date = '2026-10-29';
const baseVersion = `${date}T10:00:00.000Z`;
const editVersion = `${date}T10:01:00.000Z`;
const mutationA = 'synthetic-c1-A';
const mutationB = 'synthetic-c1-B';
const base = () => ({
  ...DataFactory.createMockDailyRecord(date, { beds: {}, lastUpdated: baseVersion }),
  meta: { revision: 7, lastMutationId: 'synthetic-c1-base', lastChangedPaths: ['*'] },
});
const editA = (): DailyRecord => ({
  ...base(),
  nurses: ['SINTETICA A'],
  nursesDayShift: ['SINTETICA A'],
  lastUpdated: editVersion,
});
const contractA = () =>
  buildDailyRecordSyncContract(editA(), {
    mutationId: mutationA,
    expectedVersion: baseVersion,
    baseRevision: 7,
    changedPaths: ['*'],
  });
const networkError = () =>
  Object.assign(new Error('Synthetic response unavailable'), { code: 'unavailable' });
let remote = base();
let nextPublish: 'accept' | 'lose_response' | 'reject_before_commit' = 'accept';

const onlyTask = async (): Promise<SyncTask> => {
  const rows = await hospitalDB.syncQueue.toArray();
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error('Expected one durable daily record task');
  return row;
};

const enqueueA = () =>
  queueDailyRecordSyncTaskWithLocalRecord(
    editA(),
    { contexts: ['staffing'], origin: 'direct_queue', syncContract: contractA() },
    {
      deferProcessing: true,
      holdForMs: 60_000,
      preOutboxHoldOwner: 'synthetic-c1-tab',
      preOutboxHoldReason: 'awaiting_remote_ack',
      wholeRecordBase: base(),
    }
  );

const recover = async (
  outcome: 'lose_response' | 'reject_before_commit',
  workerDuringRelease = false
) => {
  nextPublish = outcome;
  let sent: SyncTask | undefined;
  const state = createRemoteWriteState();
  const result = await persistLocalAndAttemptRemoteSync({
    date,
    record: editA(),
    changedPaths: ['*'],
    expectedVersion: baseVersion,
    remoteState: state,
    queueLocalBeforeRemote: enqueueA,
    remoteWrite: async () => {
      sent = await onlyTask();
      await createFirestoreSyncTransport().run(sent);
    },
    releaseLocalPreOutboxHold: async () => {
      await releaseDailyRecordPreOutboxHold(editA(), contractA());
      if (workerDuringRelease) {
        await processSyncQueue();
        expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      }
    },
    readRemoteConfirmedRecord: async () => {
      throw networkError();
    },
    onRemoteFailure: () => {},
  });
  if (!sent) throw new Error('The controller did not reach the remote boundary');
  return { sent, state, result };
};

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  delete window.__HHR_E2E_OVERRIDE__;
  resetSyncMutationIdentityForTests();
  localStorage.setItem(SESSION_OWNER_KEY, 'synthetic-c1-owner');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await hospitalDB.open();
  expect(isDatabaseInFallbackMode()).toBe(false);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.dailyRecords.put(base());
  remote = base();
  nextPublish = 'accept';
  boundary.read.mockImplementation(async () => ({
    exists: () => true,
    data: () => structuredClone(remote),
  }));
  boundary.publish.mockImplementation(
    async ({
      record,
      syncContract,
    }: Parameters<typeof saveDailyRecordWithClinicalAuthorityCallable>[0]) => {
      const outcome = nextPublish;
      nextPublish = 'accept';
      if (outcome === 'reject_before_commit') throw networkError();
      if (!syncContract?.mutationId) throw new Error('Publication requires a mutation identity');
      remote = {
        ...structuredClone(record),
        meta: {
          revision: remote.meta.revision + 1,
          lastMutationId: syncContract.mutationId,
          lastChangedPaths: syncContract.changedPaths ?? ['*'],
        },
      };
      if (outcome === 'lose_response') throw networkError();
      return {
        recordState: {
          record: structuredClone(remote),
          lastUpdated: remote.lastUpdated,
          meta: remote.meta,
        },
      };
    }
  );
});

afterEach(() => vi.restoreAllMocks());

describe('durable daily record retry identity', () => {
  it.each(['lose_response', 'reject_before_commit'] as const)(
    'retains the same durable intent, payload and remote base after %s',
    async outcome => {
      const { sent, state } = await recover(outcome);
      const recovered = await onlyTask();

      expect(state).toMatchObject({
        savedLocally: true,
        savedRemotely: false,
        queuedForRetry: true,
      });
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(editA());
      expect(recovered.payload).toEqual(sent.payload);
      expect(recovered.syncContract).toMatchObject({
        mutationId: mutationA,
        expectedVersion: baseVersion,
        baseRevision: 7,
        changedPaths: ['*'],
      });
      expect(recovered.syncContract?.mutationIds?.filter(id => id !== mutationA) ?? []).toEqual([]);
    }
  );

  it('recognizes the lost-response receipt and drains without publishing A twice', async () => {
    await recover('lose_response');
    expect(remote.meta.lastMutationId).toBe(mutationA);
    expect(boundary.publish).toHaveBeenCalledTimes(1);

    await processSyncQueue();

    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    expect(boundary.publish).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(docToRecord(remote, date));
  });

  it('publishes uncommitted A on retry with the original identity', async () => {
    await recover('reject_before_commit');
    expect(remote).toEqual(base());

    await processSyncQueue();

    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    expect(remote).toMatchObject({
      nursesDayShift: ['SINTETICA A'],
      meta: { lastMutationId: mutationA },
    });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(remote);
  });

  it('does not recreate A when the worker confirms it between release and recovery', async () => {
    await recover('lose_response', true);

    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(docToRecord(remote, date));
    expect(boundary.publish).toHaveBeenCalledTimes(1);
  });

  it('retains a real B at the same timestamp when only A is remotely confirmed', async () => {
    expect(await enqueueA()).toMatchObject({ accepted: true });
    await createFirestoreSyncTransport().run(await onlyTask());
    const confirmedA = structuredClone(remote);
    const editB: DailyRecord = { ...editA(), tensDayShift: ['SINTETICO B'] };
    expect(
      await queueDailyRecordSyncTaskWithLocalRecord(
        editB,
        {
          contexts: ['staffing'],
          origin: 'direct_queue',
          syncContract: buildDailyRecordSyncContract(editB, {
            mutationId: mutationB,
            expectedVersion: baseVersion,
            baseRevision: 7,
            changedPaths: ['*'],
          }),
        },
        { deferProcessing: true, wholeRecordBase: editA() }
      )
    ).toMatchObject({ accepted: true });
    const pending = await onlyTask();
    expect(pending.syncContract).toMatchObject({ mutationIds: [mutationA, mutationB] });

    await expect(
      completeDirectDailyRecordSyncTask({
        sentRecord: editA(),
        confirmedRecord: confirmedA,
        syncContract: contractA(),
      })
    ).resolves.toEqual(editB);
    await expect(createFirestoreSyncTransport().run(await onlyTask())).rejects.toMatchObject({
      name: 'ConcurrencyError',
      reason: 'semantic_conflict',
    });

    expect(await hospitalDB.syncQueue.toArray()).toEqual([pending]);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(editB);
    expect(remote).toEqual(confirmedA);
    expect(boundary.publish).toHaveBeenCalledTimes(1);
  });
});
