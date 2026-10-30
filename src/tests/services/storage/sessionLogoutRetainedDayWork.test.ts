/* Synthetic only: a census day whose unsent edit outlives the session that wrote it. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const remote = vi.hoisted(() => ({ day: null as unknown, duringFetch: async () => {} }));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestore: vi.fn(async () => {
    await remote.duringFetch();
    return remote.day;
  }),
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordWrites')>()),
  updateRecordPartial: vi.fn(async () => {
    throw Object.assign(new Error('synthetic offline'), { code: 'unavailable' });
  }),
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { requeueQuarantinedTask } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import { reconcileSpecialistHandoffProjections } from '@/services/storage/sync/dexieDailyRecordOutbox';
import { getDailyRecordWriteStateForVersion } from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-10-29';
const owner = 'user:synthetic-original';
const nextOwner = 'user:synthetic-next';
const serverDay = DataFactory.createMockDailyRecord(date, {
  beds: {},
  lastUpdated: '2026-10-29T09:00:00.000Z',
  nursesDayShift: ['SYNTHETIC SERVER CONFIRMED'],
});
const unsentDay = DataFactory.createMockDailyRecord(date, {
  beds: {},
  lastUpdated: '2026-10-29T10:00:00.000Z',
  nursesDayShift: ['SYNTHETIC UNSENT EDIT'],
});

/** What the person who wrote the edit needs to recover it later. */
const recoverable = (task: SyncTask | undefined) => ({
  status: task?.status,
  ownerKey: task?.ownerKey,
  payload: task?.payload,
  syncContract: task?.syncContract,
  lastErrorCode: task?.lastErrorCode,
});

const dayWrite = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-unsent-edit',
  ownerKey: owner,
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload: unsentDay,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  syncContract: {
    changedPaths: ['nursesDayShift'],
    expectedVersion: serverDay.lastUpdated,
    mutationId: 'synthetic-unsent-edit',
  },
  ...overrides,
});
const closeSession = () =>
  clearSessionScopedClientState('manual', vi.fn().mockResolvedValue(undefined));

/** Edit, then close the session with the edit still unsent. */
const closeSessionWithUnsentEdit = async (): Promise<number> => {
  await hospitalDB.dailyRecords.put(unsentDay);
  const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
  await closeSession();
  return id;
};

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration('synthetic-generation');
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-generation');
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  setFirestoreEnabled(true);
  remote.day = serverDay;
  remote.duringFetch = async () => {};
  vi.mocked(loadRemoteRecordWithFallback).mockImplementation(async (_date, options) => ({
    record: serverDay,
    issuedAgainst: options?.base ?? { kind: 'stored', record: null },
    serverConfirmed: true,
    source: 'firestore',
    compatibilityTier: 'current_firestore',
    compatibilityIntensity: 'none',
    migrationRulesApplied: [],
    cachedLocally: false,
  }));
});
afterEach(async () => {
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
  vi.clearAllMocks();
});

describe('a census day with an edit left unsent by a closed session', () => {
  it.each([
    { label: 'the same person', next: owner },
    { label: 'another person', next: nextOwner },
  ])('opens with the server day for $label, keeping the unsent edit intact', async ({ next }) => {
    const id = await closeSessionWithUnsentEdit();
    const retained = recoverable(await hospitalDB.syncQueue.get(id));
    await reconcileAuthorizedSessionOwner(next);

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.nursesDayShift).toEqual(serverDay.nursesDayShift);
    expect(result.serverConfirmed).toBe(true);
    expect(retained).toMatchObject({
      status: 'FAILED',
      ownerKey: owner,
      payload: unsentDay,
      lastErrorCode: 'session_owner_logged_out',
    });
    expect(recoverable(await hospitalDB.syncQueue.get(id))).toEqual(retained);
  });

  it('gives a new edit by the returning person its own task, never the unsent one', async () => {
    const id = await closeSessionWithUnsentEdit();
    const retained = recoverable(await hospitalDB.syncQueue.get(id));
    await reconcileAuthorizedSessionOwner(owner);

    await updatePartialDetailed(date, { nursesNightShift: ['SYNTHETIC NEW EDIT'] });

    expect(recoverable(await hospitalDB.syncQueue.get(id))).toEqual(retained);
    const others = (await hospitalDB.syncQueue.toArray()).filter(task => task.id !== id);
    expect(others).toEqual([
      expect.objectContaining({
        ownerKey: owner,
        status: 'PENDING',
        payload: expect.objectContaining({
          nursesDayShift: serverDay.nursesDayShift,
          nursesNightShift: ['SYNTHETIC NEW EDIT'],
        }),
        syncContract: expect.objectContaining({
          changedPaths: ['nursesNightShift'],
          expectedVersion: serverDay.lastUpdated,
        }),
      }),
    ]);
    const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
    expect(shown.nursesDayShift).toEqual(serverDay.nursesDayShift);
    expect(shown.nursesNightShift).toEqual(['SYNTHETIC NEW EDIT']);
  });

  it('never sends, revives or retries the unsent edit, whoever signs in next', async () => {
    const foreign = Number(
      await hospitalDB.syncQueue.add(dayWrite({ opId: 'synthetic-foreign', ownerKey: nextOwner }))
    );
    const id = await closeSessionWithUnsentEdit();
    const retained = await hospitalDB.syncQueue.get(id);
    const store = createDexieSyncQueueStore();
    const claim = {
      leaseOwner: 'synthetic-worker',
      attemptId: 'synthetic-attempt',
      leaseUntil: 9e15,
    };

    await reconcileAuthorizedSessionOwner(nextOwner);
    expect(await store.claimReadyPending(Date.now(), 10, nextOwner, claim)).toEqual([]);
    await reconcileAuthorizedSessionOwner(owner);
    expect(await store.claimReadyPending(Date.now(), 10, owner, claim)).toEqual([]);
    expect(await requeueQuarantinedTask(id, owner)).toBe(false);
    expect(await store.findReusableTask('UPDATE_DAILY_RECORD', `daily:${date}`, owner)).toBeNull();

    expect(await hospitalDB.syncQueue.get(id)).toEqual(retained);
    // Signing in as owner closed the next person's session: their send waits for them, unsent.
    expect(await hospitalDB.syncQueue.get(foreign)).toMatchObject({
      ownerKey: nextOwner,
      payload: unsentDay,
      status: 'FAILED',
      localProjection: 'released',
    });
  });

  it('keeps both the stored day and the queue when logout cannot clear the day', async () => {
    await hospitalDB.dailyRecords.put(unsentDay);
    const id = Number(await hospitalDB.syncQueue.add(dayWrite()));
    const before = await hospitalDB.syncQueue.get(id);
    vi.spyOn(hospitalDB.dailyRecords, 'clear').mockRejectedValueOnce(
      new Error('synthetic failure')
    );

    await expect(closeSession()).rejects.toThrow('Session cleanup failed');

    expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(unsentDay);
  });

  it('opens a day that an older version closed without its copy, unless a send is still active', async () => {
    const blocked = Number(
      await hospitalDB.syncQueue.add(
        dayWrite({ status: 'CONFLICT', lastErrorCode: 'synthetic_conflict', error: 'synthetic' })
      )
    );
    const before = recoverable(await hospitalDB.syncQueue.get(blocked));

    expect((await getForDateWithMeta(date, true)).record?.nursesDayShift).toEqual(
      serverDay.nursesDayShift
    );
    expect(recoverable(await hospitalDB.syncQueue.get(blocked))).toEqual(before);
    expect(await hospitalDB.syncQueue.get(blocked)).toHaveProperty('localProjection', 'released');

    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.add(dayWrite({ opId: 'synthetic-active', ownerKey: nextOwner }));
    await expect(getForDateWithMeta(date, true)).rejects.toThrow(
      'No existe la copia local de una escritura pendiente.'
    );
  });

  it('leaves the unsent edit and its base untouched when an older note is released', async () => {
    const id = await closeSessionWithUnsentEdit();
    const retained = await hospitalDB.syncQueue.get(id);
    await reconcileAuthorizedSessionOwner(owner);
    await getForDateWithMeta(date, true);
    await hospitalDB.syncQueue.add({
      opId: 'synthetic-legacy-note',
      ownerKey: owner,
      type: 'UPDATE_SPECIALIST_HANDOFF',
      key: `handoff:${date}:synthetic`,
      payload: { date, patch: {}, expectedOccupants: [] },
      timestamp: 2,
      retryCount: 0,
      status: 'FAILED',
    });

    await reconcileSpecialistHandoffProjections();

    expect(await hospitalDB.syncQueue.get(id)).toEqual(retained);
  });

  it('confirms a new edit without waiting on, or changing, the unsent one', async () => {
    const id = await closeSessionWithUnsentEdit();
    const retained = await hospitalDB.syncQueue.get(id);
    await reconcileAuthorizedSessionOwner(owner);
    await getForDateWithMeta(date, true);
    const store = createDexieSyncQueueStore();
    const edited = { ...serverDay, nursesNightShift: ['SYNTHETIC NEW EDIT'] };
    await store.saveDailyRecordWithTask(
      edited,
      dayWrite({
        opId: 'synthetic-new-edit',
        payload: edited,
        syncContract: {
          changedPaths: ['nursesNightShift'],
          expectedVersion: serverDay.lastUpdated,
          mutationId: 'synthetic-new-edit',
        },
      })
    );
    const [sent] = (await hospitalDB.syncQueue.toArray()).filter(task => task.id !== id);
    const confirmed = { ...edited, lastUpdated: '2026-10-29T11:00:00.000Z' };

    const ack = await store.completeDirectDailyRecord!({
      sentRecord: sent.payload as DailyRecord,
      confirmedRecord: confirmed,
      mutationId: 'synthetic-new-edit',
      ownerKey: owner,
    });

    expect(ack).toMatchObject({ status: 'adopted', record: confirmed });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(confirmed);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([retained]);
    expect(await getDailyRecordWriteStateForVersion(date, unsentDay.lastUpdated)).toBe('none');
  });

  it('builds on a copy another tab saved while the server day was being fetched', async () => {
    const otherTab = { ...serverDay, nursesDayShift: ['SYNTHETIC OTHER TAB'] };
    remote.duringFetch = async () => {
      await hospitalDB.dailyRecords.put(otherTab);
      await hospitalDB.syncQueue.add(
        dayWrite({ opId: 'synthetic-other-tab', payload: otherTab, status: 'PENDING' })
      );
    };

    await updatePartialDetailed(date, { nursesNightShift: ['SYNTHETIC NEW EDIT'] });

    const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
    expect(shown.nursesDayShift).toEqual(['SYNTHETIC OTHER TAB']);
    expect(shown.nursesNightShift).toEqual(['SYNTHETIC NEW EDIT']);
    expect((await hospitalDB.syncQueue.toArray()).map(task => task.payload)).toEqual([shown]);
  });
});
