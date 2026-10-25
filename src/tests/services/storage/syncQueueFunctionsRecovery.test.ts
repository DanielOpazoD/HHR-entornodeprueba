import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import {
  loadFunctionsModule,
  isFunctionsReloadRequired,
} from '@/services/firebase-runtime/functionsModuleLoader';

const createEngine = (run: () => Promise<void>) =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => true, getOwnerKey: () => null, onOnline: () => undefined },
    transport: { run },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

beforeEach(async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  await hospitalDB.syncQueue.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('keeps payload and retry budget pending through sticky imports, then syncs after recovery', async () => {
  const importModule = vi.fn(
    (): ReturnType<typeof loadFunctionsModule> =>
      Promise.reject(new TypeError('Importing a module script failed.'))
  );
  const payload = { date: '2026-10-24', beds: {}, synthetic: 'pending-change' };
  await hospitalDB.syncQueue.add({
    opId: 'synthetic-functions-recovery',
    type: 'UPDATE_DAILY_RECORD',
    payload,
    key: 'daily:2026-10-24',
    status: 'PENDING',
    timestamp: 1,
    retryCount: 2,
  });
  const engine = createEngine(async () => {
    await loadFunctionsModule(importModule);
  });
  for (let attempt = 0; attempt < 7; attempt++) {
    await hospitalDB.syncQueue.toCollection().modify({ nextAttemptAt: 0 });
    await engine.processQueue();
    expect(isFunctionsReloadRequired()).toBe(true);
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task).toMatchObject({ status: 'PENDING', retryCount: 2, payload });
    expect(task.leaseOwner).toBeUndefined();
  }
  importModule.mockImplementation(() => import('firebase/functions'));
  await hospitalDB.syncQueue.toCollection().modify({ nextAttemptAt: 0 });
  await engine.processQueue();
  expect(isFunctionsReloadRequired()).toBe(false);
  expect(await hospitalDB.syncQueue.count()).toBe(0);
});

it('keeps permanent authorization failures quarantined while Functions recovery is pending', async () => {
  await loadFunctionsModule(() =>
    Promise.reject(new TypeError('Importing a module script failed.'))
  ).catch(() => {});
  await hospitalDB.syncQueue.add({
    opId: 'synthetic-permission-failure',
    type: 'UPDATE_DAILY_RECORD',
    payload: { date: '2026-10-24' },
    key: 'daily:2026-10-24',
    status: 'PENDING',
    timestamp: 1,
    retryCount: 0,
  });
  const engine = createEngine(async () => {
    throw Object.assign(new Error('Synthetic denied'), { code: 'functions/permission-denied' });
  });
  await engine.processQueue();
  expect((await hospitalDB.syncQueue.toArray())[0]).toMatchObject({
    status: 'FAILED',
    retryCount: 0,
  });
  await loadFunctionsModule();
});
