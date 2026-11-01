import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { clearSessionDailyRecords } from '@/services/storage/sessionSyncQueuePreservation';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import {
  hasPendingNursingHandoff,
  nursingHandoffPaths,
} from '@/services/storage/sync/nursingHandoffTasks';
import {
  attemptNursingHandoffLogout,
  resumeOwnedNursingHandoff,
  downloadPendingNursingHandoff,
} from '@/services/storage/sync/nursingHandoffSession';
import { downloadBlob } from '@/services/exporters/exportDownload';

const { processQueue } = vi.hoisted(() => ({ processQueue: vi.fn() }));
vi.mock('@/services/storage/sync/publicSyncQueue', () => ({ processSyncQueue: processQueue }));
vi.mock('@/services/exporters/exportDownload', () => ({ downloadBlob: vi.fn() }));

const owner = 'user:synthetic-A';
const date = '2026-11-01';
const record = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    handoffNovedadesDayShift: 'SYNTHETIC PRIVATE NOTE',
  });
const task = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  opId: 'synthetic-nursing',
  ownerKey: owner,
  payload: record(),
  status: 'PENDING',
  timestamp: 1,
  retryCount: 0,
  syncContract: {
    changedPaths: ['handoffNovedadesDayShift'],
    expectedVersion: `${date}T10:00:00.000Z`,
    mutationId: 'synthetic-mutation',
  },
  ...overrides,
});
const admit = (key = owner) => {
  localStorage.setItem(SESSION_OWNER_KEY, key);
  localStorage.setItem(SESSION_GENERATION_KEY, `generation-${key}`);
  setSessionGeneration(`generation-${key}`);
};
const makeEngine = (run: (task: SyncTask) => Promise<void>) =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: {
      isOnline: () => navigator.onLine,
      getOwnerKey: () => localStorage.getItem(SESSION_OWNER_KEY),
      onOnline: () => {},
    },
    transport: { run },
    batchSize: 1,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  admit();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  setSessionGeneration(null);
});

it('recognizes only explicit nursing paths, including notes for the separate crib', () => {
  const paths = [
    'beds.R1.handoffNoteDayShift',
    'beds.R1.clinicalCrib.handoffNoteNightShift',
    'handoffSharedChecklist.crashCartCode',
    'handoffNightReceives',
  ];
  expect(nursingHandoffPaths(task({ syncContract: { changedPaths: paths } }))).toEqual(paths);
  for (const changedPaths of [
    undefined,
    ['*'],
    ['beds.R1'],
    ['beds.R1.medicalHandoffNote'],
    ['medicalHandoffNovedades'],
    ['nurses'],
    ['rayenSyncHistory'],
  ]) {
    expect(
      hasPendingNursingHandoff(task({ contexts: ['handoff'], syncContract: { changedPaths } }))
    ).toBe(false);
  }
  expect(hasPendingNursingHandoff(task({ status: 'RETIRED' }))).toBe(false);
});

it('waits for a confirmed send and leaves unrelated pending tasks untouched', async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const engine = makeEngine(run);
  processQueue.mockImplementation(options => engine.processQueue(options));
  const other = task({ opId: 'eloisa', syncContract: { changedPaths: ['rayenSyncHistory'] } });
  const otherId = await hospitalDB.syncQueue.add(other);
  await hospitalDB.syncQueue.add(task());
  expect(await attemptNursingHandoffLogout(owner, 'Enfermera A')).toBe(true);
  expect(run).toHaveBeenCalledOnce();
  expect(await hospitalDB.syncQueue.toArray()).toEqual([{ ...other, id: otherId }]);
});

it('does not start queue work for other pending tasks or infer nursing from a snapshot', async () => {
  const rows = [
    task({ syncContract: { changedPaths: ['rayenSyncHistory'] } }),
    task({ syncContract: { changedPaths: ['*'] } }),
  ];
  await hospitalDB.syncQueue.bulkAdd(rows);
  const before = await hospitalDB.syncQueue.toArray();
  expect(await attemptNursingHandoffLogout(owner, 'Enfermera A')).toBe(true);
  expect(processQueue).not.toHaveBeenCalled();
  expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
});

it('returns immediately offline and preserves the note with its staff label', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await hospitalDB.syncQueue.add(task());
  expect(await attemptNursingHandoffLogout(owner, 'Enfermera A')).toBe(false);
  expect(processQueue).not.toHaveBeenCalled();
  expect(await hospitalDB.syncQueue.toArray()).toEqual([
    expect.objectContaining({
      status: 'PENDING',
      payload: record(),
      nursingHandoffOwnerLabel: 'Enfermera A',
    }),
  ]);
});

it('bounds a hung send at ten seconds, ignores its late ACK and permits a later owned retry', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let finish!: () => void;
  const run = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    )
    .mockResolvedValue(undefined);
  const engine = makeEngine(run);
  processQueue.mockImplementation(options => engine.processQueue(options));
  await hospitalDB.syncQueue.add(task());
  const result = attemptNursingHandoffLogout(owner, 'Enfermera A');
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toBe(false);
  await clearSessionDailyRecords(owner);
  finish();
  await Promise.resolve();
  expect(await hospitalDB.syncQueue.toArray()).toEqual([
    expect.objectContaining({
      status: 'FAILED',
      lastErrorCode: 'session_owner_logged_out',
      payload: record(),
    }),
  ]);
  await resumeOwnedNursingHandoff(owner);
  await vi.waitFor(async () => expect(await hospitalDB.syncQueue.count()).toBe(0));
  expect(run).toHaveBeenCalledTimes(2);
});

it('on return A automatically sends only its logout-held handoff, retaining other work', async () => {
  await hospitalDB.syncQueue.bulkAdd([
    task(),
    task({ opId: 'other', syncContract: { changedPaths: ['rayenSyncHistory'] } }),
  ]);
  await clearSessionDailyRecords(owner);
  const before = (await hospitalDB.syncQueue.toArray()).find(row => row.opId === 'other');
  const run = vi.fn().mockResolvedValue(undefined);
  const engine = makeEngine(run);
  processQueue.mockImplementation(options => engine.processQueue(options));
  expect(await resumeOwnedNursingHandoff(owner)).toEqual([]);
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  await vi.waitFor(async () => expect(await hospitalDB.syncQueue.toArray()).toEqual([before]));
  expect(run.mock.calls[0][0]).toMatchObject({
    ownerKey: owner,
    nursingHandoffRecovery: true,
    syncContract: task().syncContract,
  });
});

it('recovers A nursing work after a network retry limit was reached before logout, leaving other held work alone', async () => {
  const nursing = task({
    status: 'FAILED',
    retryCount: 20,
    lastErrorCategory: 'network',
    lastErrorCode: 'functions/unavailable',
  });
  const other = task({
    ...nursing,
    opId: 'other-held-network',
    syncContract: { changedPaths: ['rayenSyncHistory'] },
  });
  await hospitalDB.syncQueue.bulkAdd([nursing, other]);
  await clearSessionDailyRecords(owner);
  const retainedOther = (await hospitalDB.syncQueue.toArray()).find(row => row.opId === other.opId);
  const run = vi.fn().mockResolvedValue(undefined);
  const engine = makeEngine(run);
  processQueue.mockImplementation(options => engine.processQueue(options));
  await resumeOwnedNursingHandoff(owner);
  await vi.waitFor(async () =>
    expect(await hospitalDB.syncQueue.toArray()).toEqual([retainedOther])
  );
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][0]).toMatchObject({
    ownerKey: owner,
    retryCount: 0,
    nursingHandoffRecovery: true,
    syncContract: nursing.syncContract,
  });
});

it.each(['CONFLICT', 'FAILED'] as const)(
  'never automatically revives a nursing %s requiring review',
  async status => {
    await hospitalDB.syncQueue.add(
      task({
        status,
        lastErrorCategory: status === 'CONFLICT' ? 'conflict' : 'validation',
        lastErrorCode: 'synthetic-review-required',
        projectionReleased: true,
      })
    );
    const before = await hospitalDB.syncQueue.toArray();
    await resumeOwnedNursingHandoff(owner);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(processQueue).not.toHaveBeenCalled();
  }
);

it('B receives only A staff identity, cannot adopt or send the held note, and sees no unrelated owner', async () => {
  await hospitalDB.syncQueue.bulkAdd([
    task({ nursingHandoffOwnerLabel: 'Enfermera A' }),
    task({ ownerKey: 'user:synthetic-C', syncContract: { changedPaths: ['rayenSyncHistory'] } }),
  ]);
  await clearSessionDailyRecords(owner);
  const before = await hospitalDB.syncQueue.toArray();
  admit('user:synthetic-B');
  expect(await resumeOwnedNursingHandoff('user:synthetic-B')).toEqual(['Enfermera A']);
  expect(processQueue).not.toHaveBeenCalled();
  const run = vi.fn().mockResolvedValue(undefined);
  await makeEngine(run).processQueue();
  expect(run).not.toHaveBeenCalled();
  expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
});

it('downloads the existing unconfirmed backup envelope without deleting or retiring the send', async () => {
  const id = await hospitalDB.syncQueue.add(task());
  await downloadPendingNursingHandoff(owner);
  const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
  expect(name).toBe(`hhr-envio-local-${id}.json`);
  const reader = new FileReader();
  const content = await new Promise<string>(resolve => {
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(JSON.parse(content)).toMatchObject({
    schemaVersion: 1,
    remotelyConfirmed: false,
    task: { id, payload: record() },
  });
  expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
    status: 'PENDING',
    payload: record(),
  });
});

it('refuses recovery and backup reads under the wrong admitted identity', async () => {
  await hospitalDB.syncQueue.add(task());
  admit('user:synthetic-B');
  await expect(resumeOwnedNursingHandoff(owner)).rejects.toThrow('La sesión cambió');
  await expect(downloadPendingNursingHandoff(owner)).rejects.toThrow('La sesión cambió');
  expect(downloadBlob).not.toHaveBeenCalled();
});

it.each(['manual', 'automatic'] as const)(
  'preserves an unconfirmed nursing handoff through %s cleanup',
  async reason => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const original = task();
    const id = await hospitalDB.syncQueue.add(original);
    expect(await attemptNursingHandoffLogout(owner, 'Enfermera A')).toBe(false);
    if (reason === 'manual') await downloadPendingNursingHandoff(owner);
    await clearSessionDailyRecords(owner);
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
      payload: original.payload,
      syncContract: original.syncContract,
      status: 'FAILED',
      lastErrorCode: 'session_owner_logged_out',
    });
    expect(await hospitalDB.dailyRecords.count()).toBe(0);
  }
);

it.each([false, true])(
  'does not dispatch A under B during transport preparation (logout-only=%s)',
  async nursingHandoffOnly => {
    let actor = owner;
    let ready!: () => void;
    let proceed!: () => void;
    const prepared = new Promise<void>(resolve => {
      ready = resolve;
    });
    const wait = new Promise<void>(resolve => {
      proceed = resolve;
    });
    const published = vi.fn();
    const engine = createSyncQueueEngine({
      store: createDexieSyncQueueStore(),
      runtime: {
        isOnline: () => true,
        getOwnerKey: () => owner,
        getActorKey: () => actor,
        onOnline: () => {},
      },
      transport: {
        run: async (_task, assertCanPublish) => {
          ready();
          await wait;
          assertCanPublish?.();
          published();
        },
      },
      batchSize: 1,
      maxPendingTasks: 100,
      maxRetries: 3,
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
    });
    await hospitalDB.syncQueue.add(task());
    const sending = engine.processQueue({ nursingHandoffOnly });
    await prepared;
    actor = 'user:synthetic-B';
    proceed();
    await sending;
    expect(published).not.toHaveBeenCalled();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([
      expect.objectContaining({ ownerKey: owner, payload: record() }),
    ]);
  }
);
