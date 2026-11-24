import { captureAuthoringSession } from '@/services/session/authoringSession';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { SESSION_OWNER_KEY } from '@/services/session/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/session/sessionStorageTransition';
import {
  getDailyRecordReviewBackup,
  retireReviewedDailyRecordTask,
  reviewBlockedDailyRecordTask,
} from '@/services/storage/sync/dailyRecordTaskRetirement';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import { getPendingDailyRecordProjection } from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import { listDailyRecordProjectionHolders } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const OWNER = 'user:synthetic-retirement';
const DATE = '2026-10-22';
const record: DailyRecord = {
  date: DATE,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  lastUpdated: '2026-10-22T20:00:00.000Z',
};
const failed: SyncTask = {
  opId: 'synthetic-original-send',
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${DATE}`,
  payload: record,
  timestamp: 1,
  retryCount: 0,
  status: 'FAILED',
  ownerKey: OWNER,
  error: 'Missing or insufficient permissions',
  lastErrorCode: 'permission-denied',
  lastErrorCategory: 'authorization',
  syncContract: {
    expectedVersion: record.lastUpdated,
    changedPaths: ['nurses'],
    mutationId: 'original',
  },
};
let taskId: number;
beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.setItem(SESSION_OWNER_KEY, OWNER);
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-generation');
  setSessionGeneration('synthetic-generation');
  taskId = await hospitalDB.syncQueue.add(structuredClone(failed));
});
afterEach(() => {
  vi.restoreAllMocks();
  setSessionGeneration(null);
  localStorage.removeItem(SESSION_OWNER_KEY);
  localStorage.removeItem(SESSION_GENERATION_KEY);
});

const reviewTask = async () => {
  const review = await reviewBlockedDailyRecordTask(taskId);
  if (!review) throw new Error('Synthetic blocked send must be reviewable');
  return review;
};

it('captures a blocked send without retrying or changing its payload', async () => {
  const review = await reviewTask();
  expect(review.task).toEqual({ ...failed, id: taskId });
  const backup = await getDailyRecordReviewBackup(review);
  expect(backup && JSON.parse(backup)).toMatchObject({
    remotelyConfirmed: false,
    task: { payload: record },
  });
  expect(await hospitalDB.syncQueue.get(taskId)).toEqual(review.task);
});

it('never claims a durable discard from an unbound memory table', async () => {
  const review = await reviewTask();
  const queue = hospitalDB.syncQueue;
  const binding = Object.getOwnPropertyDescriptor(queue, 'db');
  if (!binding) throw new Error('Expected the real Dexie table binding');
  Object.defineProperty(queue, 'db', { value: undefined, configurable: true });
  try {
    await expect(reviewBlockedDailyRecordTask(taskId)).rejects.toThrow(
      'La base local no está disponible.'
    );
    await expect(retireReviewedDailyRecordTask(review)).rejects.toThrow(
      'La base local no está disponible.'
    );
  } finally {
    Object.defineProperty(queue, 'db', binding);
  }
  expect(await hospitalDB.syncQueue.get(taskId)).toEqual(review.task);
});

it('deletes only the reviewed send and lets the next remote read replace its projection', async () => {
  await hospitalDB.dailyRecords.put(record);
  const otherId = await hospitalDB.syncQueue.add({
    ...failed,
    opId: 'other',
    key: 'daily:2026-10-23',
    status: 'PENDING',
  });
  const before = await reviewTask();
  expect(await retireReviewedDailyRecordTask(before)).toBe(true);
  expect(await hospitalDB.syncQueue.get(taskId)).toBeUndefined();
  expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);
  expect((await hospitalDB.syncQueue.get(otherId))?.status).toBe('PENDING');
  expect(await listDailyRecordProjectionHolders(DATE)).toEqual([]);
  expect(await getPendingDailyRecordProjection(DATE)).toBeNull();
  const store = createDexieSyncQueueStore();
  const telemetry = buildSyncQueueTelemetryFromRows(await store.listAll(OWNER), Date.now(), 5);
  expect(telemetry).toMatchObject({ pending: 1, failed: 0, conflict: 0, retrying: 0 });
  expect((await store.listRecent(5, OWNER)).map(task => task.id)).toEqual([otherId]);
  expect(
    await store.claimReadyPending(Date.now(), 5, OWNER, {
      leaseOwner: 'worker',
      leaseUntil: Date.now() + 1000,
      attemptId: 'attempt',
    })
  ).toHaveLength(1);
  expect(await store.requeueQuarantinedTask?.(taskId, OWNER)).toBe(false);
  const confirmed = {
    ...record,
    nurses: ['SYNTHETIC CONFIRMED'],
    lastUpdated: '2026-10-23T20:00:00.000Z',
  };
  const reconcile = vi.fn();
  expect(await store.adoptAuthoritativeDailyRecord?.(confirmed, OWNER, reconcile)).toMatchObject({
    status: 'adopted',
  });
  expect(reconcile).not.toHaveBeenCalled();
  expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(confirmed);
  expect(await hospitalDB.syncQueue.get(taskId)).toBeUndefined();
});

it('keeps the payload intact when the IndexedDB delete fails', async () => {
  const review = await reviewTask();
  vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
    new Error('synthetic write failure')
  );
  await expect(retireReviewedDailyRecordTask(review)).rejects.toThrow('synthetic write failure');
  expect(await hospitalDB.syncQueue.get(taskId)).toEqual(review.task);
});

it('refuses a stale confirmation even when id, timestamp and operation id did not change', async () => {
  const review = await reviewTask();
  const changed = { ...record, nurses: ['SYNTHETIC NEW EDIT'] };
  await hospitalDB.syncQueue.update(taskId, { payload: changed });
  expect(await retireReviewedDailyRecordTask(review)).toBe(false);
  expect(await getDailyRecordReviewBackup(review)).toBeNull();
  expect(await hospitalDB.syncQueue.get(taskId)).toMatchObject({
    status: 'FAILED',
    payload: changed,
  });
});

it.each(['PENDING', 'PROCESSING', 'RETIRED'] as const)(
  'never deletes a task that became %s during confirmation',
  async status => {
    const review = await reviewTask();
    await hospitalDB.syncQueue.update(taskId, { status });
    expect(await retireReviewedDailyRecordTask(review)).toBe(false);
    expect(await reviewBlockedDailyRecordTask(taskId)).toBeNull();
    expect((await hospitalDB.syncQueue.get(taskId))?.status).toBe(status);
  }
);

it.each(['owner', 'generation', 'shared-generation'] as const)(
  'refuses confirmation after a change of %s',
  async change => {
    const review = await reviewTask();
    if (change === 'owner') localStorage.setItem(SESSION_OWNER_KEY, 'user:other');
    else if (change === 'generation') setSessionGeneration('other-generation');
    else localStorage.setItem(SESSION_GENERATION_KEY, 'other-generation');
    expect(await retireReviewedDailyRecordTask(review)).toBe(false);
    expect(await getDailyRecordReviewBackup(review)).toBeNull();
    expect((await hospitalDB.syncQueue.get(taskId))?.status).toBe('FAILED');
  }
);

it('deletes legacy ownerless sends once the current user confirms their discard', async () => {
  await hospitalDB.syncQueue.update(taskId, { ownerKey: undefined });
  expect(await retireReviewedDailyRecordTask(await reviewTask())).toBe(true);
  expect(await hospitalDB.syncQueue.get(taskId)).toBeUndefined();
});

it('rolls back discard if the shared session changes during the transaction', async () => {
  const review = await reviewTask();
  const remove = hospitalDB.syncQueue.delete.bind(hospitalDB.syncQueue);
  vi.spyOn(hospitalDB.syncQueue, 'delete').mockImplementationOnce((...args) =>
    remove(...args).then(result => {
      localStorage.setItem(SESSION_GENERATION_KEY, 'replacement-session');
      return result;
    })
  );
  await expect(retireReviewedDailyRecordTask(review)).rejects.toThrow('La sesión cambió.');
  expect(await hospitalDB.syncQueue.get(taskId)).toEqual(review.task);
});

it('deletes a conflicted send once confirmed without converting its rejection into an ACK', async () => {
  await hospitalDB.syncQueue.update(taskId, { status: 'CONFLICT' });
  expect(await retireReviewedDailyRecordTask(await reviewTask())).toBe(true);
  expect(await hospitalDB.syncQueue.get(taskId)).toBeUndefined();
});

it('does not offer this whole-census action for a leftover retired-type task or detached occupant edits', async () => {
  // A specialist note queued before the old medical handoff was retired.
  await hospitalDB.syncQueue.update(taskId, { type: 'UPDATE_SPECIALIST_HANDOFF' as never });
  expect(await reviewBlockedDailyRecordTask(taskId)).toBeNull();
  await hospitalDB.syncQueue.update(taskId, {
    type: 'UPDATE_DAILY_RECORD',
    key: `daily:${DATE}:detached:1:[]`,
  });
  expect(await reviewBlockedDailyRecordTask(taskId)).toBeNull();
});

it('creates a fresh task cleanly for the same date after a blocked send was discarded', async () => {
  await hospitalDB.dailyRecords.put(record);
  expect(await retireReviewedDailyRecordTask(await reviewTask())).toBe(true);
  const fresh = { ...record, nurses: ['SYNTHETIC FRESH'], lastUpdated: '2026-10-23T20:00:00.000Z' };
  expect(
    await createDexieSyncQueueStore().saveDailyRecordWithTask(
      fresh,
      {
        ...failed,
        opId: 'fresh',
        payload: fresh,
        status: 'PENDING',
      },
      undefined,
      undefined,
      captureAuthoringSession()
    )
  ).toBe('created');
  expect(await hospitalDB.syncQueue.get(taskId)).toBeUndefined();
  expect((await listDailyRecordProjectionHolders(DATE)).map(task => task.payload)).toEqual([fresh]);
});
