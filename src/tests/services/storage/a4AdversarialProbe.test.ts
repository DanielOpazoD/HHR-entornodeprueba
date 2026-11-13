import { captureAuthoringSession } from '@/services/storage/authoringSession';
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, B, clone, day, harnessState, writeNote } from './specialistHandoffOutboxHarness';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
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

import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { admitRemoteDailyRecords } from '@/services/repositories/dailyRecordLocalCachePersistence';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
for (const path of ['suscripción', 'E', 'rango', 'mantenimiento', 'A'] as const) {
  for (const scenario of [
    'same',
    'other',
    'empty',
    'episode',
    'move',
    'passport',
    'inverse',
    'short',
    'long',
    'cleared',
    'RN',
    'mother',
    'otherRN',
    'daily',
    'ACKrace',
    'createRace',
  ] as const) {
    it(`${path} ${scenario}`, async () => {
      const { remote } = await prepare('especialista');
      if (scenario === 'other') remote.beds.R4 = B();
      if (scenario === 'empty')
        remote.beds.R4 = A('R4', { patientName: '', rut: '', clinicalEpisodeId: '' });
      if (scenario === 'episode') remote.beds.R4.clinicalEpisodeId = 'reentry';
      if (scenario === 'move') {
        remote.beds.H1C1 = { ...clone(remote.beds.R4), bedId: 'H1C1' };
        remote.beds.R4 = B();
      }
      if (scenario === 'passport') remote.beds.R4.documentType = 'Pasaporte';
      if (scenario === 'inverse') {
        remote.beds.R4.medicalHandoffNote = 'SERVIDOR A';
        remote.beds.R4.medicalHandoffEntries![0].note = 'SERVIDOR A';
        const local = clone(remote);
        local.beds.R4 = B();
        local.lastUpdated = '2026-10-24T15:00:00.000Z';
        await hospitalDB.dailyRecords.put(local);
      }
      if (['short', 'long'].includes(scenario)) {
        const text =
          scenario === 'short' ? 'Mejor' : 'Nota posterior mucho más larga de un colega sintético';
        remote.beds.R4.medicalHandoffNote = text;
        remote.beds.R4.medicalHandoffEntries![0].note = text;
      }
      if (scenario === 'cleared') {
        await hospitalDB.syncQueue.clear();
        await hospitalDB.dailyRecords.clear();
        remote.beds.R4.medicalHandoffNote = 'Base anterior';
        remote.beds.R4.medicalHandoffEntries![0].note = 'Base anterior';
        await hospitalDB.dailyRecords.put(remote);
        await writeNote(remote, 'R4', 'entry-A', NOTE);
        remote.beds.R4.medicalHandoffNote = '';
        remote.beds.R4.medicalHandoffEntries![0].note = '';
      }
      if (['RN', 'mother', 'otherRN'].includes(scenario)) {
        await hospitalDB.syncQueue.clear();
        remote.beds.R4.clinicalCrib = A('R4', {
          patientName: 'RN sintético',
          clinicalEpisodeId: 'rn1',
        });
        await hospitalDB.dailyRecords.put(remote);
        if (scenario === 'mother') await writeNote(remote, 'R4', 'entry-A', NOTE);
        else {
          const { fields } = buildMedicalEntryNoteFields(
            remote.beds.R4.clinicalCrib!,
            'entry-A',
            NOTE,
            null,
            DATE,
            '2026-10-24T10:00:00.000Z'
          );
          h.offline = true;
          await updatePartialDetailed(
            DATE,
            Object.fromEntries(
              Object.entries(fields).map(([k, v]) => ['beds.R4.clinicalCrib.' + k, v])
            ) as DailyRecordPatch,
            { authoringSession: captureAuthoringSession(), baseRecord: remote }
          );
          h.offline = false;
          if (scenario === 'otherRN') remote.beds.R4.clinicalCrib!.clinicalEpisodeId = 'rn2';
        }
      }
      if (scenario === 'daily')
        await hospitalDB.syncQueue.add({
          key: 'daily:' + DATE,
          type: 'UPDATE_DAILY_RECORD',
          status: 'PENDING',
          opId: 'daily',
          payload: await hospitalDB.dailyRecords.get(DATE),
          timestamp: 1,
          retryCount: 0,
        });
      if (scenario === 'ACKrace') await hospitalDB.syncQueue.clear();
      if (scenario === 'createRace') {
        await hospitalDB.syncQueue.clear();
        await hospitalDB.dailyRecords.put(remote);
        await writeNote(remote, 'R4', 'entry-A', NOTE);
      }
      h.remote = remote;
      const tasks = JSON.stringify(await hospitalDB.syncQueue.toArray());
      const localBefore = await hospitalDB.dailyRecords.get(DATE);
      const out = await read(path, remote);
      const stored = await hospitalDB.dailyRecords.get(DATE);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(JSON.parse(tasks));
      expect(observ(out)).toEqual(observ(stored));
      if (scenario === 'same' || scenario === 'createRace') expect(note(out)).toBe(NOTE);
      if (['other', 'empty', 'episode', 'move', 'passport', 'otherRN'].includes(scenario))
        expect(JSON.stringify(out)).not.toContain(NOTE);
      if (scenario === 'inverse')
        expect(
          out?.beds.R4.patientName === 'Paciente B Sintético' &&
            JSON.stringify(out?.beds.R4).includes('SERVIDOR A')
        ).toBe(false);
      if (scenario === 'short' || scenario === 'long' || scenario === 'cleared')
        expect(note(out)).toBe(note(remote));
      if (scenario === 'daily') expect(out).toEqual(localBefore);
      if (scenario === 'mother') {
        expect(note(out)).toBe(NOTE);
        expect(out?.beds.R4.clinicalCrib?.medicalHandoffEntries?.[0].note).toBe('');
      }
      if (scenario === 'RN') {
        expect(note(out)).toBe('');
        expect(out?.beds.R4.clinicalCrib?.medicalHandoffEntries?.[0].note).toBe(NOTE);
      }
    });
  }
  it(`${path} idempotence`, async () => {
    const { remote } = await prepare('especialista');
    h.remote = remote;
    await read(path, remote);
    const put = vi.spyOn(hospitalDB.dailyRecords, 'put');
    const bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
    const event = vi.fn();
    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
    try {
      for (let i = 0; i < 3; i++) await read(path, remote);
      expect(put.mock.calls.length + bulk.mock.calls.length + event.mock.calls.length).toBe(0);
    } finally {
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
    }
  });
}
function observ(r: DailyRecord | null | undefined) {
  return (
    r && {
      patient: r.beds.R4.patientName,
      episode: r.beds.R4.clinicalEpisodeId,
      note: note(r),
      legacy: r.beds.R4.medicalHandoffNote,
      rn: r.beds.R4.clinicalCrib?.medicalHandoffEntries?.[0].note,
    }
  );
}
it('two sequential notes same entry preserve their durable order', async () => {
  const { remote } = await prepare('especialista');
  const [first] = await hospitalDB.syncQueue.toArray();
  await hospitalDB.syncQueue.update(first.id!, { status: 'PROCESSING' });
  await writeNote((await hospitalDB.dailyRecords.get(DATE))!, 'R4', 'entry-A', 'SECOND');
  const tasks = await hospitalDB.syncQueue.toArray();
  await hospitalDB.dailyRecords.put(remote);
  const [result] = await admitRemoteDailyRecords([{ record: remote, remoteRecord: remote }]);
  expect(note(result.record)).toBe('SECOND');
  expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
});

for (const path of ['suscripción', 'E', 'rango', 'mantenimiento', 'A'] as const)
  for (const status of [
    'PENDING',
    'PROCESSING',
    'FAILED',
    'CONFLICT',
    'RETIRED',
    'released',
    'quarantine',
  ] as const)
    it(`state ${path} ${status}`, async () => {
      const { remote } = await prepare('especialista');
      const [task] = await hospitalDB.syncQueue.toArray();
      await hospitalDB.syncQueue.update(
        task.id!,
        status === 'released'
          ? { projectionReleased: true }
          : status === 'quarantine'
            ? { status: 'FAILED' }
            : { status }
      );
      h.remote = remote;
      const tasks = await hospitalDB.syncQueue.toArray();
      const out = await read(path, remote);
      expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
      expect(note(out)).toBe(['PENDING', 'PROCESSING'].includes(status) ? NOTE : '');
    });
for (const op of ['ACK', 'create'] as const)
  it(`atomic race ${op}`, async () => {
    const { remote } = await prepare('especialista');
    const base = await hospitalDB.dailyRecords.get(DATE);
    const original = hospitalDB.transaction.bind(hospitalDB);
    let once = true;
    vi.spyOn(hospitalDB, 'transaction').mockImplementation((async (
      ...args: Parameters<typeof hospitalDB.transaction>
    ) => {
      if (once) {
        once = false;
        if (op === 'ACK') {
          await hospitalDB.syncQueue.clear();
          await hospitalDB.dailyRecords.put(remote);
        } else {
          await hospitalDB.syncQueue.clear();
          await hospitalDB.dailyRecords.put(remote);
          await writeNote(remote, 'R4', 'entry-A', 'RACE NEW');
        }
      }
      return original(...args);
    }) as typeof hospitalDB.transaction);
    const [result] = await admitRemoteDailyRecords([
      {
        record: remote,
        remoteRecord: remote,
        expectedBase: { kind: 'stored', record: base ?? null },
      },
    ]);
    expect(note(result.record)).toBe(op === 'ACK' ? '' : 'RACE NEW');
  });
it('order byte comparison specialties', async () => {
  const remote = day(DATE, {
    R4: A('R4', {
      medicalHandoffEntries: [
        { id: 'entry-A', specialty: 'Medicina Interna', note: '' },
        { id: 'entry-B', specialty: 'Cirugía', note: '' },
      ],
    }),
  });
  await hospitalDB.dailyRecords.put(remote);
  h.remote = clone(remote);
  await writeNote(remote, 'R4', 'entry-A', NOTE);
  const [t] = await hospitalDB.syncQueue.toArray();
  await hospitalDB.syncQueue.update(t.id!, { status: 'PROCESSING' });
  await writeNote((await hospitalDB.dailyRecords.get(DATE))!, 'R4', 'entry-B', 'Nota B');
  const tasks = await hospitalDB.syncQueue.toArray();
  const outs = [];
  for (const reverse of [false, true]) {
    await hospitalDB.syncQueue.clear();
    for (const t of reverse ? [...tasks].reverse() : tasks)
      await hospitalDB.syncQueue.add({ ...t, id: undefined });
    await hospitalDB.dailyRecords.put(remote);
    const [r] = await admitRemoteDailyRecords([{ record: remote, remoteRecord: remote }]);
    outs.push(JSON.stringify(r.record));
  }
  expect(outs[0]).toBe(outs[1]);
});

it('benchmark 366 repeated', async () => {
  const records = Array.from({ length: 366 }, (_, i) =>
    day(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), { R4: A() })
  );
  const timings = [];
  const queries = [];
  for (let i = 0; i < 5; i++) {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    const query = vi.spyOn(hospitalDB.syncQueue, 'where');
    const start = performance.now();
    await admitRemoteDailyRecords(records.map(record => ({ record, remoteRecord: record })));
    timings.push(performance.now() - start);
    queries.push(query.mock.calls.length);
    query.mockRestore();
  }
});
