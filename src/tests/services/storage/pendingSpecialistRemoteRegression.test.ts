import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  A,
  B,
  clone,
  day,
  harnessState,
  writeNote,
  createServerHandler,
  reconnect,
} from './specialistHandoffOutboxHarness';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
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
type Path = 'puntual' | 'suscripción' | 'rango' | 'mantenimiento' | 'JSON' | 'heredada';
type Situation =
  | 'diaria'
  | 'especialista'
  | 'optimista'
  | 'local nueva'
  | 'otro paciente'
  | 'otro episodio'
  | 'limpia';
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
  const remote = {
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

import { saveRecordsStrict } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getPendingDailyRecordProjection } from '@/services/storage/sync/dailyRecordSyncQueueReadService';

for (const text of [
  'Mejor',
  'Nota posterior de colega mucho más extensa que la nota pendiente sintética',
  '',
  NOTE,
]) {
  it(`remote original after empty admission: ${text || 'base vacía'}`, async () => {
    const { remote, tasks } = await prepare('especialista');
    expect(note(await read('suscripción', remote))).toBe(NOTE);
    remote.lastUpdated = '2026-10-24T12:00:00.000Z';
    remote.beds.R4.medicalHandoffNote = text;
    remote.beds.R4.medicalHandoffEntries![0].note = text;
    h.remote = remote;
    const expected = text === '' ? NOTE : text;
    expect(note(await read('suscripción', remote))).toBe(expected);
    expect(note(await hospitalDB.dailyRecords.get(DATE))).toBe(expected);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
    h.handler = createServerHandler();
    h.role = 'admin';
    await reconnect();
    expect(note(h.remote)).toBe(expected);
    expect(note(await read('suscripción', h.remote!))).toBe(expected);
  });
}
it.each(['', 'Base anterior'])('nonempty base with remote note %s', async text => {
  const base = day(DATE, { R4: A('R4', { clinicalEpisodeId: 'ep_admission_a' }) });
  base.beds.R4.medicalHandoffNote = 'Base anterior';
  base.beds.R4.medicalHandoffEntries![0].note = 'Base anterior';
  await hospitalDB.dailyRecords.put(base);
  h.remote = clone(base);
  await writeNote(base, 'R4', 'entry-A', NOTE);
  const remote = { ...clone(base), lastUpdated: '2026-10-24T12:00:00.000Z' };
  remote.beds.R4.medicalHandoffNote = text;
  remote.beds.R4.medicalHandoffEntries![0].note = text;
  h.remote = remote;
  expect(note(await read('suscripción', remote))).toBe(text ? NOTE : '');
  expect(note(await hospitalDB.dailyRecords.get(DATE))).toBe(text ? NOTE : '');
});
it('pending read returns and stores its projection', async () => {
  const { remote } = await prepare('especialista');
  await hospitalDB.dailyRecords.put(remote);
  expect(note(await getPendingDailyRecordProjection(DATE))).toBe(NOTE);
  expect(note(await hospitalDB.dailyRecords.get(DATE))).toBe(NOTE);
});
it('range uses a bounded queue read and measures 366 days', async () => {
  const records = Array.from({ length: 366 }, (_, i) =>
    day(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), { R4: A() })
  );
  const times: number[] = [];
  const query = vi.spyOn(hospitalDB.syncQueue, 'where');
  for (let i = 0; i < 9; i++) {
    await hospitalDB.dailyRecords.clear();
    query.mockClear();
    const start = performance.now();
    expect((await saveRecordsStrict(records, { preserveUnresolvedWrites: true })).ok).toBe(true);
    times.push(performance.now() - start);
  }
  process.stderr.write(JSON.stringify({ times, queueReads: query.mock.calls.length }) + '\n');
  expect(query.mock.calls.length).toBeLessThanOrEqual(2);
});

it('clean pending read needs only the existing queue lookup', async () => {
  await hospitalDB.dailyRecords.put(day(DATE, { R4: A() }));
  const query = vi.spyOn(hospitalDB.syncQueue, 'where');
  expect(await getPendingDailyRecordProjection(DATE)).toBeNull();
  expect(query).toHaveBeenCalledTimes(1);
});
