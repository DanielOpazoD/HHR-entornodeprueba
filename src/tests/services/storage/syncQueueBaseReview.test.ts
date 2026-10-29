import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { toSyncQueueOperationSnapshot } from '@/services/storage/sync/syncQueueOperationSnapshot';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import { buildSyncQueueStats } from '@/hooks/controllers/syncQueueMonitorController';
import { listQuarantinedOperations } from '@/features/rayen-import/components/localSyncPresentation';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncTask, SyncTaskContract } from '@/services/storage/syncQueueTypes';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  set: vi.fn(),
  invoke: vi.fn(),
  mode: 'client_only',
  fence: false,
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: mocks.read,
  getDocFromServer: mocks.read,
  runTransaction: mocks.transaction,
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-base-review' }),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => mocks.mode,
  isServerClinicalWriteFenceActive: async () => mocks.fence,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.invoke }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: async () => ({}) },
}));

const date = '2026-10-28';
const baseTime = `${date}T10:00:00.000Z`;
const owner = 'user:synthetic-base-review';
const reviewCode = 'sync_daily_record_base_review';
const record = (lastUpdated = `${date}T10:01:00.000Z`) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    nurses: ['SINTETICA BASE', ''],
    nursesDayShift: ['SINTETICA BASE', ''],
    tensDayShift: ['SINTETICO LOCAL', '', ''],
    lastUpdated,
  });
const stored = () => ({
  ...record(baseTime),
  tensDayShift: ['SINTETICO REMOTO', '', ''],
  meta: { revision: 7, lastMutationId: 'synthetic-remote' },
});
const task = (contract: SyncTaskContract = {}) =>
  ({
    opId: 'synthetic-base-review',
    ownerKey: owner,
    key: `daily:${date}`,
    type: 'UPDATE_DAILY_RECORD',
    payload: record(),
    timestamp: 1,
    retryCount: 0,
    status: 'PENDING',
    origin: 'full_save_retry',
    syncContract: {
      changedPaths: ['*'],
      expectedVersion: baseTime,
      baseRevision: 7,
      mutationId: 'synthetic-local-B',
      mutationIds: ['synthetic-local-A', 'synthetic-local-B'],
      ...contract,
    },
  }) satisfies SyncTask;
const snapshot = (data: unknown) => ({ exists: () => true, data: () => data });
const store = () => createDexieSyncQueueStore();
const transport = () =>
  createFirestoreSyncTransport({ getDb: () => ({}) as Firestore, ready: Promise.resolve() });
const engine = (maxRetries = 1) =>
  createSyncQueueEngine({
    store: store(),
    runtime: { isOnline: () => true, getOwnerKey: () => owner, onOnline: () => {} },
    transport: transport(),
    batchSize: 8,
    maxPendingTasks: 192,
    maxRetries,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });
const processTask = async (input: ReturnType<typeof task>, maxRetries = 1) => {
  await hospitalDB.dailyRecords.put(input.payload);
  await hospitalDB.syncQueue.add(input);
  await engine(maxRetries).processQueue();
  return store().listAll(owner);
};
const recovery = (row: SyncTask) =>
  listQuarantinedOperations([toSyncQueueOperationSnapshot(row)])[0]?.recovery;
const expectDurableReview = async (row: SyncTask, input: SyncTask) => {
  expect(recovery(row)).toBe('review_base');
  expect(row).toMatchObject({
    status: 'CONFLICT',
    lastErrorCode: reviewCode,
    lastErrorCategory: 'conflict',
    ownerKey: owner,
  });
  expect(row.payload).toEqual(input.payload);
  expect(row.syncContract).toEqual(input.syncContract);
  expect(await store().requeueQuarantinedTask!(row.id!, owner)).toBe(false);
  hospitalDB.close();
  await hospitalDB.open();
  expect(await hospitalDB.syncQueue.toArray()).toEqual([row]);
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(input.payload);
  expect(await store().requeueQuarantinedTask!(row.id!, owner)).toBe(false);
  expect(await hospitalDB.syncQueue.toArray()).toEqual([row]);
};

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  mocks.mode = 'client_only';
  mocks.fence = false;
  mocks.read.mockResolvedValue(snapshot(stored()));
  mocks.transaction.mockImplementation(async (_db, callback) =>
    callback({ get: mocks.read, set: mocks.set })
  );
});

describe('opaque daily-record base review', () => {
  it.each(['client_only', 'enforced'])(
    'retains the rejected base through worker, public snapshot and real panel in %s',
    async mode => {
      mocks.mode = mode;
      const input = task({ baseRevision: 6 });
      const [row] = await processTask(input);
      await expectDurableReview(row, input);
      const html = renderToStaticMarkup(
        createElement(RayenSyncQueueDetails, {
          stats: buildSyncQueueStats(buildSyncQueueTelemetryFromRows([row], Date.now(), 25)),
          operations: [toSyncQueueOperationSnapshot(row)],
          working: false,
          refresh: async () => {},
        })
      );
      expect(html).toContain('Los cambios siguen guardados en este equipo.');
      expect(html).toContain('Descartar envío');
      expect(html).not.toContain('Reintentar');
      expect(mocks.set).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
    }
  );

  describe.each(['revision_mismatch', 'version_mismatch'])(
    'authority race normalized from %s after valid preflight',
    mismatch => {
      it.each([undefined, [], ['*'], [' * ', ' ', '*'], [' ']])(
        'requires durable review for opaque paths %j',
        async changedPaths => {
          mocks.mode = 'enforced';
          mocks.invoke.mockRejectedValue({ code: 'functions/aborted', message: mismatch });
          const input = task({ changedPaths });
          const [row] = await processTask(input);
          expect(mocks.invoke).toHaveBeenCalledOnce();
          expect(mocks.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
              record: input.payload,
              expectedLastUpdated: baseTime,
              syncContract: input.syncContract,
            })
          );
          await expectDurableReview(row, input);
          expect(row.error).toContain('HHR detectó una versión más reciente');
          expect(mocks.set).not.toHaveBeenCalled();
        }
      );
    }
  );

  it('requires review when the server fence makes shadow mode publish through the callable', async () => {
    mocks.mode = 'shadow';
    mocks.fence = true;
    mocks.invoke.mockRejectedValue({ code: 'functions/aborted', message: 'revision_mismatch' });
    const input = task();
    const [row] = await processTask(input);
    await expectDurableReview(row, input);
    expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ mode: 'shadow' }));
    expect(mocks.invoke.mock.calls[0][0].dryRun).toBeUndefined();
  });

  it.each([
    ['full semantic conflict', ['*'], 'functions/aborted', 'clinical invariant blocked', 'retry'],
    ['granular semantic conflict', ['tensDayShift'], 'functions/aborted', 'blocked', 'retry'],
    ['granular revision', [' tensDayShift '], 'functions/aborted', 'revision_mismatch', 'retry'],
    ['granular version', ['tensDayShift'], 'functions/aborted', 'version_mismatch', 'retry'],
    ['network', ['*'], 'functions/unavailable', 'synthetic offline', 'retry'],
    [
      'authorization',
      ['*'],
      'functions/permission-denied',
      'synthetic denied',
      'review_authorization',
    ],
  ])('keeps existing recovery for %s', async (_label, changedPaths, code, message, action) => {
    mocks.mode = 'enforced';
    mocks.invoke.mockRejectedValue({ code, message });
    const input = task({ changedPaths });
    const [row] = await processTask(input);
    expect(recovery(row)).toBe(action);
    expect(row.lastErrorCode).not.toBe(reviewCode);
    expect(await store().requeueQuarantinedTask!(row.id!, owner)).toBe(true);
    expect(await hospitalDB.syncQueue.get(row.id!)).toMatchObject({
      status: 'PENDING',
      ownerKey: owner,
      payload: input.payload,
      syncContract: input.syncContract,
    });
  });

  it('does not translate an omitted committed record into base review', async () => {
    mocks.mode = 'enforced';
    mocks.invoke.mockResolvedValue({ data: { success: true } });
    const [row] = await processTask(task());
    expect(row).toMatchObject({ status: 'CONFLICT', lastErrorCode: 'unknown' });
    expect(recovery(row)).toBe('retry');
    expect(row.error).toContain('authority omitted the committed record');
  });

  it('keeps direct publish after a shadow dry-run version rejection', async () => {
    mocks.mode = 'shadow';
    mocks.invoke.mockRejectedValue({ code: 'functions/aborted', message: 'version_mismatch' });
    expect(await processTask(task())).toEqual([]);
    expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(mocks.set).toHaveBeenCalledOnce();
  });

  it('acknowledges its exact uncompacted receipt before rejecting the old base', async () => {
    const input = task({ baseRevision: 6, mutationIds: ['synthetic-local-B'] });
    const confirmed = {
      ...record(),
      meta: { revision: 8, lastMutationId: 'synthetic-local-B' },
    };
    mocks.read.mockResolvedValue(snapshot(confirmed));
    expect(await processTask(input)).toEqual([]);
    expect(await hospitalDB.dailyRecords.get(date)).toMatchObject({
      date,
      lastUpdated: confirmed.lastUpdated,
      tensDayShift: confirmed.tensDayShift,
      meta: confirmed.meta,
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('retains a rejected episode downgrade without automatically sending it again', async () => {
    mocks.mode = 'enforced';
    mocks.invoke.mockRejectedValue({
      code: 'functions/failed-precondition',
      message:
        'El guardado se bloqueó porque esta copia perdió la referencia del episodio en R1. ' +
        'Recarga el censo y revisa el paciente y su ingreso antes de volver a guardar.',
    });
    const input = task();
    const [row] = await processTask(input, 3);

    expect(row).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'functions/failed-precondition',
      lastErrorCategory: 'validation',
      ownerKey: owner,
      payload: input.payload,
      syncContract: input.syncContract,
    });
    expect(listQuarantinedOperations([toSyncQueueOperationSnapshot(row)])[0]).toMatchObject({
      canRetire: true,
      detail: expect.stringContaining('Recarga el censo y revisa'),
    });
    hospitalDB.close();
    await hospitalDB.open();
    await engine(3).processQueue();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([row]);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(input.payload);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each(['failed-precondition', 'functions/failed-precondition'])(
    'keeps legacy %s base_required recovery after reopening storage',
    async lastErrorCode => {
      const input = {
        ...task(),
        status: 'FAILED' as const,
        lastErrorCode,
        error: 'base_required: synthetic missing base',
      };
      await hospitalDB.dailyRecords.put(input.payload);
      const id = await hospitalDB.syncQueue.add(input);
      expect(recovery({ ...input, id: Number(id) })).toBe('review_base');
      expect(await store().requeueQuarantinedTask!(Number(id), owner)).toBe(false);
      hospitalDB.close();
      await hospitalDB.open();
      expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...input, id });
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(input.payload);
    }
  );

  it('does not infer a base-review reason from historical unknown text', async () => {
    const input = {
      ...task(),
      status: 'CONFLICT' as const,
      lastErrorCode: 'unknown',
      error: 'El censo cambió o su base no es verificable. Conservamos los cambios para revisión.',
    };
    const id = Number(await hospitalDB.syncQueue.add(input));
    expect(recovery({ ...input, id })).toBe('retry');
    expect(await store().requeueQuarantinedTask!(id, owner)).toBe(true);
  });
});
