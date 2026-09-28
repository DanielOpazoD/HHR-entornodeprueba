/* @flake-safe: The emulator read window requires today's synthetic census date. */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

const { authority } = vi.hoisted(() => ({ authority: vi.fn() }));
let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: (...args: unknown[]) => authority(...args),
}));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';

const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST
    ? describe
    : describe.skip;
const DATE = new Date().toISOString().slice(0, 10);
const RECORD_PATH = `hospitals/hanga_roa/dailyRecords/${DATE}`;
const at = (time: string) => `${DATE}T${time}.000Z`;
const MUTATION = 'synthetic-lost-ack-mutation';
const unavailable = () =>
  Object.assign(new Error('Synthetic lost response'), { code: 'unavailable' });
const makeRecord = (): DailyRecord => ({
  date: DATE,
  lastUpdated: at('10:00:00'),
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  nursesDayShift: ['Synthetic nurse A', ''],
});
const createEngine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    transport: createFirestoreSyncTransport(),
    runtime: {
      isOnline: () => true,
      getOwnerKey: () => 'synthetic-owner',
      onOnline: () => undefined,
    },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

// Actual queue, IndexedDB adapter and Firestore reads. The callable is a fault injector:
// it persists a synthetic commit in the emulator before dropping its response, not a server test.
describeEmulator('Queue recovery after a persisted remote commit loses its response', () => {
  let env: RulesTestEnvironment;
  let now: number;
  const remoteRead = async () => {
    let record: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async context => {
      record = (await context.firestore().doc(RECORD_PATH).get()).data();
    });
    return record;
  };
  const remoteWrite = (record: DailyRecord, mutationId: string, revision: number) =>
    env.withSecurityRulesDisabled(async context =>
      context
        .firestore()
        .doc(RECORD_PATH)
        .set({
          ...record,
          meta: { revision, lastMutationId: mutationId, lastChangedPaths: ['nursesDayShift'] },
        })
    );
  const enqueue = async () => {
    const record = makeRecord();
    await createEngine().queueDailyRecordTaskWithLocalRecord(
      record,
      {
        syncContract: {
          mutationId: MUTATION,
          expectedVersion: at('09:55:00'),
          changedPaths: ['nursesDayShift'],
        },
      },
      { deferProcessing: true }
    );
    return record;
  };
  const reopenAtRetry = async () => {
    const [pending] = await hospitalDB.syncQueue.toArray();
    expect(pending).toMatchObject({
      status: 'PENDING',
      retryCount: 1,
      syncContract: { mutationId: MUTATION },
    });
    expect(pending.nextAttemptAt).toBeGreaterThan(now);
    hospitalDB.close();
    await hospitalDB.open();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([pending]);
    now = pending.nextAttemptAt!;
    return pending;
  };

  beforeAll(async () => {
    const emulator = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    env = await initializeTestEnvironment({
      projectId: 'demo-hhr-lost-ack-recovery',
      firestore: {
        ...emulator,
        rules: readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      },
    });
    activeDb = env
      .authenticatedContext('synthetic-nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await hospitalDB.open();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    now = Date.parse(at('10:00:00'));
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'enforced');
    authority.mockReset();
    authority.mockImplementation(
      async ({ record, syncContract }: { record: DailyRecord; syncContract: SyncTaskContract }) => {
        await remoteWrite(record, syncContract.mutationId!, 1);
        throw unavailable();
      }
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await hospitalDB.open();
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('recognizes the committed mutation after reopening and drains it without a second publish', async () => {
    const record = await enqueue();
    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(1);
    const committed = await remoteRead();
    expect(committed).toMatchObject({ ...record, meta: { revision: 1, lastMutationId: MUTATION } });
    await reopenAtRetry();
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);

    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(1);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    expect(await remoteRead()).toEqual(committed);
    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(1);
  });

  it('quarantines the retry if another writer changed the same path after the first commit', async () => {
    const record = await enqueue();
    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(1);
    expect(await remoteRead()).toMatchObject({
      ...record,
      meta: { revision: 1, lastMutationId: MUTATION },
    });
    await remoteWrite(
      { ...record, lastUpdated: at('10:05:00'), nursesDayShift: ['Synthetic nurse B', ''] },
      'synthetic-other-writer',
      2
    );
    const newer = await remoteRead();
    const pending = await reopenAtRetry();

    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(1);
    expect(await remoteRead()).toEqual(newer);
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      {
        id: pending.id,
        status: 'CONFLICT',
        lastErrorCategory: 'conflict',
        payload: record,
        syncContract: { mutationId: MUTATION },
      },
    ]);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);
  });

  it('still publishes on retry when the first attempt failed before committing remotely', async () => {
    authority.mockRejectedValueOnce(unavailable());
    const record = await enqueue();
    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(1);
    expect(await remoteRead()).toBeUndefined();
    const pending = await reopenAtRetry();
    authority.mockImplementationOnce(
      async ({
        record: committed,
        syncContract,
      }: {
        record: DailyRecord;
        syncContract: SyncTaskContract;
      }) => {
        await remoteWrite(committed, syncContract.mutationId!, 1);
        return {
          revision: 1,
          recordState: { record: committed, lastUpdated: committed.lastUpdated },
        };
      }
    );

    await createEngine().processQueue();
    expect(authority).toHaveBeenCalledTimes(2);
    expect(authority.mock.calls[1][0].syncContract).toEqual(pending.syncContract);
    expect(await remoteRead()).toMatchObject({
      ...record,
      meta: { revision: 1, lastMutationId: MUTATION },
    });
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(record);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
