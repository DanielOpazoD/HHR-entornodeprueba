import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, B, clone, day, harnessState, writeNote } from './specialistHandoffOutboxHarness';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import {
  syncWithFirestoreDetailed,
  adoptAuthoritativeRecord,
  subscribeDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import { syncRecordsRange } from '@/services/records/recordQueryService';
import { hydrateRangeRecords } from '@/services/admin/dataMaintenanceSupport';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { migrateFromLocalStorage } from '@/services/storage/indexeddb/indexedDbMigrationService';
import {
  createDailyRecordQueryOptions,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';

const wire = vi.hoisted(() => ({
  emit: undefined as
    | undefined
    | ((
        record: DailyRecord,
        pending: boolean,
        metadata: { fromCache: boolean; hasPendingWrites: boolean }
      ) => void),
}));
// Only remote delivery is substituted; selectors, publication, outbox and Dexie are real.
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordsRangeFromFirestore: async () => [clone(harnessState().remote)],
  subscribeToRecord: (_date: string, callback: typeof wire.emit) => {
    wire.emit = callback;
    return () => {
      wire.emit = undefined;
    };
  },
}));

const DATE = '2026-10-24';
const NOTE = 'Nota especialista sintética pendiente';
const Q = 'Diagnóstico optimista sintético';
const _paths = [
  'puntual',
  'suscripción',
  'rango',
  'mantenimiento',
  'JSON',
  'heredada',
  'E',
  'A',
] as const;
type Path = (typeof _paths)[number];
const _situations = [
  'diaria',
  'especialista',
  'optimista',
  'local nueva',
  'otro paciente',
  'otro episodio',
  'limpia',
] as const;
type Situation = (typeof _situations)[number];
const h = harnessState();
let client: QueryClient;
const note = (record: DailyRecord | null | undefined) =>
  record?.beds.R4.medicalHandoffEntries?.[0]?.note;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-admission');
  clearPendingDailyRecordPatchesForTests();
  resetMedicalHandoffDraftMemoryForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  h.remote = null;
  h.offline = false;
  h.authorityMode = false;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  client.clear();
  wire.emit = undefined;
  clearPendingDailyRecordPatchesForTests();
  resetMedicalHandoffDraftMemoryForTests();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

async function prepare(situation: Situation) {
  const base = day(DATE, {
    R4: A('R4', { pathology: 'Diagnóstico base', clinicalEpisodeId: 'ep_admission_a' }),
  });
  base.nursesDayShift = ['Local sintética'];
  await hospitalDB.dailyRecords.put(base);
  h.remote = clone(base);
  if (
    situation === 'especialista' ||
    situation === 'otro paciente' ||
    situation === 'otro episodio'
  ) {
    const result = await writeNote(base, 'R4', 'entry-A', NOTE);
    expect(result.result).toMatchObject({ queuedForRetry: true, updatedRemotely: false });
    expect(note(await hospitalDB.dailyRecords.get(DATE))).toBe(NOTE);
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      {
        type: 'UPDATE_SPECIALIST_HANDOFF',
        status: 'PENDING',
        key: expect.stringMatching(/^handoff:/),
      },
    ]);
  }
  if (situation === 'diaria') {
    const task: SyncTask = {
      opId: 'synthetic-admission-daily',
      key: `daily:${DATE}`,
      type: 'UPDATE_DAILY_RECORD',
      status: 'PENDING',
      payload: base,
      timestamp: 1,
      retryCount: 0,
    };
    await hospitalDB.syncQueue.add(task);
  }
  if (situation === 'optimista' || situation === 'otro paciente' || situation === 'otro episodio') {
    registerPendingDailyRecordPatch(DATE, { 'beds.R4.pathology': Q });
  }
  if (situation === 'local nueva') {
    await hospitalDB.dailyRecords.put({ ...base, lastUpdated: '2026-10-24T14:00:00.000Z' });
  }
  const remote: DailyRecord = {
    ...clone(base),
    nursesDayShift: ['Remota sintética'],
    lastUpdated: '2026-10-24T11:00:00.000Z',
  };
  if (situation === 'otro paciente') remote.beds.R4 = B();
  if (situation === 'otro episodio')
    remote.beds.R4 = A('R4', {
      clinicalEpisodeId: 'ep_admission_reentry',
      admissionDate: '2026-10-23',
      pathology: 'Nuevo episodio',
    });
  h.remote = remote;
  const local = await hospitalDB.dailyRecords.get(DATE);
  if (!local) throw new Error('Missing synthetic local row');
  setDailyRecordQueryData(client, DATE, local);
  return { local, remote, tasks: await hospitalDB.syncQueue.toArray() };
}

async function read(path: Path, remote: DailyRecord): Promise<DailyRecord | null | undefined> {
  if (path === 'E') return (await syncWithFirestoreDetailed(DATE))?.record;
  if (path === 'A') return adoptAuthoritativeRecord(remote);
  if (path === 'puntual') {
    return (
      await client.fetchQuery(createDailyRecordQueryOptions({ getForDateWithMeta }, DATE, client))
    ).record;
  }
  if (path === 'suscripción') {
    let stop = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        stop = createDailyRecordSubscription(
          {
            getForDateWithMeta,
            subscribeDetailed: (date, listener, failure) =>
              subscribeDetailed(
                date,
                (result, pending) => {
                  listener(result, pending);
                  resolve();
                },
                result => {
                  failure?.(result);
                  reject(new Error('Synthetic subscription failed'));
                }
              ),
          },
          DATE,
          client
        );
        if (!wire.emit) throw new Error('Missing remote listener');
        wire.emit(clone(remote), false, { fromCache: false, hasPendingWrites: false });
      });
      return client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(DATE))?.record;
    } finally {
      stop();
    }
  }
  if (path === 'rango') return (await syncRecordsRange(DATE, DATE))[0];
  if (path === 'mantenimiento') return (await hydrateRangeRecords(DATE, DATE))[0];
  if (path === 'JSON') {
    const result = await importDataJSONDetailed(
      new File([JSON.stringify({ [DATE]: remote })], 'synthetic.json', { type: 'application/json' })
    );
    expect(result).toEqual({
      success: true,
      outcome: 'clean',
      importedCount: 1,
      repairedCount: 0,
      skippedEntries: [],
    });
    return undefined; // Import returns counts, not a record or remote confirmation.
  }
  localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [DATE]: remote }));
  expect(await migrateFromLocalStorage()).toBe(true);
  expect(localStorage.getItem('indexeddb_migration_complete')).toBe('true');
  expect(localStorage.getItem('hanga_roa_hospital_data')).toBe(JSON.stringify({ [DATE]: remote }));
  return undefined; // Legacy migration returns a boolean.
}

import { migrateLegacyData } from '@/services/repositories/dataMigration';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import * as firebase from 'firebase/firestore';
import * as fresh from '@/hooks/controllers/dailyRecordFreshnessGateController';
import * as confirm from '@/hooks/controllers/dailyRecordRemoteConfirmationController';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
for (const path of ['suscripción', 'E', 'rango', 'mantenimiento'] as const)
  it(`stable empty ${path}`, async () => {
    const { remote } = await prepare('limpia');
    await hospitalDB.dailyRecords.clear();
    const put = vi.spyOn(hospitalDB.dailyRecords, 'put'),
      bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    const ev = vi.fn();
    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, ev);
    const writes = [],
      events = [];
    try {
      for (let i = 0; i < 5; i++) {
        put.mockClear();
        bulk.mockClear();
        ev.mockClear();
        await read(path, remote);
        writes.push(put.mock.calls.length + bulk.mock.calls.length);
        events.push(ev.mock.calls.length);
      }
    } finally {
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, ev);
    }
    expect(writes).toEqual([1, 0, 0, 0, 0]);
  });
for (const first of ['suscripción', 'E'] as const)
  for (const second of ['puntual', 'E'] as const)
    it(`sequential CAS ${first} then ${second}`, async () => {
      const { remote } = await prepare('limpia');
      await read(first, remote);
      const result =
        second === 'E' ? await syncWithFirestoreDetailed(DATE) : await getForDateWithMeta(DATE);
      expect(result?.serverConfirmed).toBe(true);
    });
for (const delayed of ['puntual', 'E'] as const)
  it(`inflight CAS ${delayed} with S`, async () => {
    let { remote } = await prepare('limpia');
    remote = prepareDailyRecordForPersistence(
      resolveDailyRecordConflict(migrateLegacyData(remote, DATE), migrateLegacyData(remote, DATE)),
      DATE
    );
    delete remote.rayenSyncHistory;
    delete remote.rayenBedCollisionResolutions;
    h.remote = remote;
    await hospitalDB.dailyRecords.clear();
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>(r => (release = r));
    const original = firebase.getDoc;
    vi.mocked(firebase.getDoc).mockImplementationOnce(async (...args) => {
      started = true;
      await gate;
      return original(...args);
    });
    const pending = delayed === 'E' ? syncWithFirestoreDetailed(DATE) : getForDateWithMeta(DATE);
    await vi.waitFor(() => expect(started).toBe(true));
    await read('suscripción', remote);
    release();
    const result = await pending;
    expect(result?.serverConfirmed).toBe(false);
    expect(result?.record).toEqual(await hospitalDB.dailyRecords.get(DATE));
  });
for (const path of ['suscripción', 'E', 'rango', 'mantenimiento'] as const)
  it(`patch after ${path}`, async () => {
    const { remote } = await prepare('limpia');
    await read(path, remote);
    const base = (await hospitalDB.dailyRecords.get(DATE))!;
    h.offline = true;
    const result = await updatePartialDetailed(
      DATE,
      { 'beds.R4.pathology': 'Diagnóstico editado sintético' },
      { baseRecord: base }
    );
    h.offline = false;
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(result.savedLocally).toBe(true);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].syncContract?.changedPaths).toEqual(['beds.R4.pathology']);
  });
for (const path of ['suscripción', 'E', 'rango', 'mantenimiento'] as const)
  it(`metadata ${path}`, async () => {
    const { remote } = await prepare('limpia');
    Object.assign(remote, {
      clinicalDerivedLayout: { version: 1, generation: 'synthetic-generation' },
      meta: { revision: 17 },
      schemaVersion: 1,
    });
    h.remote = remote;
    await hospitalDB.dailyRecords.clear();
    await read(path, remote);
    const row = await hospitalDB.dailyRecords.get(DATE);
    for (const key of ['clinicalDerivedLayout', 'meta', 'lastUpdated', 'schemaVersion'] as const)
      expect(row).toHaveProperty(key, Reflect.get(remote, key));
  });
for (const path of ['suscripción', 'E'] as const)
  it(`daily holder ${path}`, async () => {
    const { remote } = await prepare('diaria');
    let result: SyncDailyRecordResult | null | undefined;
    if (path === 'E') result = await syncWithFirestoreDetailed(DATE);
    else {
      const stop = subscribeDetailed(DATE, r => (result = r));
      wire.emit!(remote, false, { fromCache: false, hasPendingWrites: false });
      await vi.waitFor(() => expect(result).toBeDefined());
      stop();
    }
    expect(result).toMatchObject({
      serverConfirmed: true,
      sourceOfTruth: 'local',
      consistencyState: 'local_kept',
    });
  });
for (const path of ['suscripción', 'puntual'] as const)
  it(`real publication ${path}`, async () => {
    const { remote } = await prepare('especialista');
    fresh.resetDailyRecordFreshnessGateForTests();
    fresh.markDailyRecordRemoteConfirmed(DATE, { source: 'query', confirmedRecord: clone(remote) });
    const mark = vi.spyOn(fresh, 'markDailyRecordRemoteConfirmed');
    const apply = vi.spyOn(confirm, 'applyDailyRecordRemoteConfirmation');
    if (path === 'puntual') await read('E', remote);
    const published = await read(path, remote);
    expect(note(published)).toBe(NOTE);
    expect(mark).toHaveBeenCalled();
    for (const [, params] of mark.mock.calls) expect(params).not.toHaveProperty('confirmedRecord');
    for (const [state] of apply.mock.calls)
      expect(JSON.stringify(state.lastConfirmedRecord)).not.toContain(NOTE);
  });
for (const available of [true, false])
  it(`null E available ${available}`, async () => {
    await prepare('limpia');
    h.remote = null;
    h.offline = false;
    if (!available)
      vi.mocked(firebase.getDoc).mockRejectedValueOnce(new Error('Synthetic unavailable'));
    const put = vi.spyOn(hospitalDB.dailyRecords, 'put'),
      bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    const result = await syncWithFirestoreDetailed(DATE);
    expect(result?.record).toEqual(await hospitalDB.dailyRecords.get(DATE));
    expect(put.mock.calls.length + bulk.mock.calls.length).toBe(0);
  });
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { runRemoteSaveIntegrityCheck } from '@/services/repositories/dailyRecordRemoteWriteController';
import { resolveBlockingFieldShrinkages } from '@/services/repositories/dailyRecordFieldShrinkageGuard';
for (const path of ['suscripción', 'E'] as const)
  it(`transport after ${path}`, async () => {
    const { remote: raw } = await prepare('limpia');
    await hospitalDB.dailyRecords.clear();
    await read(path, raw);
    const admittedRaw = (await hospitalDB.dailyRecords.get(DATE))!;
    expect(Object.keys(admittedRaw).sort()).toEqual(
      Object.keys(migrateLegacyData(raw, DATE)).sort()
    );
    // The existing write command canonicalizes legacy shapes on main too.
    // Use its idempotent schema for the transport assertion, without optional Rayen arrays.
    const remote = prepareDailyRecordForPersistence(migrateLegacyData(raw, DATE), DATE);
    delete remote.rayenSyncHistory;
    delete remote.rayenBedCollisionResolutions;
    h.remote = clone(remote);
    await hospitalDB.dailyRecords.clear();
    await read(path, remote);
    const base = (await hospitalDB.dailyRecords.get(DATE))!;
    await runRemoteSaveIntegrityCheck(DATE, base);
    expect(await resolveBlockingFieldShrinkages(DATE, base, { 'beds.R4.pathology': 'Dx' })).toEqual(
      []
    );
    h.offline = true;
    await updatePartialDetailed(
      DATE,
      { 'beds.R4.pathology': 'Diagnóstico editado sintético' },
      { baseRecord: base }
    );
    h.offline = false;
    const [task] = await hospitalDB.syncQueue.toArray();
    const writes: unknown[] = [];
    vi.mocked(firebase.runTransaction).mockImplementation(async (_db, run) =>
      run({
        get: async () => ({ exists: () => true, data: () => clone(remote) }),
        set: (_ref: unknown, data: unknown) => {
          writes.push(clone(data));
        },
      } as never)
    );
    await createFirestoreSyncTransport().run(task);
    expect(writes).toHaveLength(1);
    expect(
      Object.keys(writes[0] as Record<string, unknown>).filter(key => !(key in remote))
    ).toEqual([]);
    expect(writes[0]).not.toHaveProperty('rayenSyncHistory');
    expect(writes[0]).not.toHaveProperty('rayenBedCollisionResolutions');
  });

for (const available of [true, false])
  it(`null S available ${available}`, async () => {
    await prepare('limpia');
    h.remote = null;
    const put = vi.spyOn(hospitalDB.dailyRecords, 'put'),
      bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    let result: SyncDailyRecordResult | null | undefined;
    const stop = subscribeDetailed(DATE, r => (result = r));
    wire.emit!(null as never, false, { fromCache: !available, hasPendingWrites: false });
    await vi.waitFor(() => expect(result).toBeDefined());
    stop();
    expect(put.mock.calls.length + bulk.mock.calls.length).toBe(0);
  });
it('inverse E then S', async () => {
  const { remote } = await prepare('limpia');
  await read('E', remote);
  await read('suscripción', remote);
  expect(await hospitalDB.syncQueue.count()).toBe(0);
});
