import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A, B, clone, day, harnessState, writeNote } from './specialistHandoffOutboxHarness';
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
  PENDING_DAILY_RECORD_PATCH_STORAGE_KEY,
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
const paths = ['puntual', 'suscripción', 'rango', 'mantenimiento', 'JSON', 'heredada'] as const;
type Path = (typeof paths)[number];
const situations = [
  'diaria',
  'especialista',
  'optimista',
  'local nueva',
  'otro paciente',
  'otro episodio',
  'limpia',
] as const;
type Situation = (typeof situations)[number];
const h = harnessState();
let client: QueryClient;
const note = (record: DailyRecord | null | undefined) =>
  record?.beds.R4.medicalHandoffEntries?.[0]?.note;
const isExternalCopy = (path: Path) => path === 'JSON' || path === 'heredada';

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
    const hasPending = (await hospitalDB.syncQueue.count()) > 0;
    const result = await importDataJSONDetailed(
      new File([JSON.stringify({ [DATE]: remote })], 'synthetic.json', { type: 'application/json' })
    );
    expect(result).toEqual({
      success: !hasPending,
      outcome: hasPending ? 'blocked' : 'clean',
      importedCount: hasPending ? 0 : 1,
      repairedCount: 0,
      skippedEntries: [],
      ...(hasPending ? { pendingDates: [DATE] } : {}),
    });
    return undefined; // Import returns counts, not a record or remote confirmation.
  }
  localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [DATE]: remote }));
  expect(await migrateFromLocalStorage()).toBe(true);
  expect(localStorage.getItem('indexeddb_migration_complete')).toBe('true');
  expect(localStorage.getItem('hanga_roa_hospital_data')).toBe(JSON.stringify({ [DATE]: remote }));
  return undefined; // Legacy migration returns a boolean.
}

// Compare clinical content across schema/default normalization at the public read boundary.
const observed = (record: DailyRecord | null | undefined) =>
  record && {
    date: record.date,
    lastUpdated: record.lastUpdated,
    nurses: record.nursesDayShift,
    patient: record.beds.R4.patientName,
    rut: record.beds.R4.rut,
    episode: record.beds.R4.clinicalEpisodeId,
    pathology: record.beds.R4.pathology,
    note: note(record),
    transfers: record.transfers,
    discharges: record.discharges,
  };

for (const path of paths) {
  describe(`admisión ${path}: copia local / llamador / cola intacta`, () => {
    for (const situation of situations) {
      // Design step 2 fixes specialist projection in S/R/M; step 3 fixes point Q publication.
      const knownDefect = situation === 'optimista' && path === 'puntual';
      const testCase = knownDefect ? it.fails : it;
      if (knownDefect) {
        it(`${situation}: entrega base remota sin retirar cola ni parche (invariantes del defecto)`, async () => {
          const { remote, tasks } = await prepare(situation);
          const patchBefore = localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);
          const returned = await read(path, remote);
          expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
          expect(localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toBe(patchBefore);
          expect((await hospitalDB.dailyRecords.get(DATE))?.nursesDayShift).toEqual(
            remote.nursesDayShift
          );
          expect(returned?.nursesDayShift).toEqual(remote.nursesDayShift);
          if (situation === 'optimista')
            expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R4.pathology).toBe(
              remote.beds.R4.pathology
            );
        });
      }
      const outcome =
        path === 'JSON'
          ? 'respaldo por comando; D3 rechaza días pendientes'
          : isExternalCopy(path)
            ? 'copia externa reemplaza fila; llamador recibe conteo/booleano (D3 pendiente si colisiona)'
            : situation === 'diaria'
              ? 'conserva fila local y la devuelve'
              : situation === 'local nueva'
                ? `${path === 'rango' ? 'remoto' : 'local'} en fila y retorno (D1 pendiente)`
                : situation === 'especialista'
                  ? 'nota pendiente durable y visible'
                  : situation === 'optimista'
                    ? `base durable; ${path === 'puntual' || path === 'suscripción' ? 'Q' : 'base'} para llamador`
                    : 'identidad y base remotas en fila y retorno';
      testCase(
        `${situation}: ${outcome}; cola intacta${knownDefect ? ' (defecto conocido)' : ''}`,
        async () => {
          const { local, remote, tasks } = await prepare(situation);
          const patchBefore = localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY);
          const returned = await read(path, remote);
          const stored = await hospitalDB.dailyRecords.get(DATE);
          if (path === 'JSON') {
            expect(returned).toBeUndefined();
            if (tasks.length) {
              expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
              expect(observed(stored)).toEqual(observed(local));
            } else {
              expect(observed(stored)).toEqual(observed(remote));
              expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
                { origin: 'backup_restore' },
              ]);
            }
            return;
          }
          // Known-defect queue/patch invariants also run above without an expected-failure marker.
          expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
          if (situation === 'optimista')
            expect(localStorage.getItem(PENDING_DAILY_RECORD_PATCH_STORAGE_KEY)).toBe(patchBefore);
          if (isExternalCopy(path)) {
            // Design step 4 / D3: characterize replacement until omit-day versus block-batch is decided.
            expect(returned).toBeUndefined();
            expect(observed(stored)).toEqual(observed(remote));
            return;
          }
          if (situation === 'diaria') {
            expect(stored).toEqual(local);
            expect(observed(returned)).toEqual(observed(local));
            return;
          }
          if (situation === 'especialista') {
            expect.soft(note(stored), 'durable pending note').toBe(NOTE);
            expect.soft(note(returned), 'caller pending note').toBe(NOTE);
            expect(stored?.nursesDayShift).toEqual(remote.nursesDayShift);
            expect(returned?.nursesDayShift).toEqual(remote.nursesDayShift);
            return;
          }
          if (situation === 'local nueva') {
            // Design steps 1/3 / D1: preserve the present per-path choice, pending product decision.
            const expected = ['suscripción', 'rango', 'mantenimiento', 'ACK readback'].includes(
              path
            )
              ? remote
              : local;
            expect(observed(stored)).toEqual(observed(expected));
            expect(observed(returned)).toEqual(observed(expected));
            return;
          }
          expect(observed(stored)).toEqual(observed(remote));
          if (situation === 'optimista') {
            const projected = clone(remote);
            projected.beds.R4.pathology = Q;
            expect(observed(returned)).toEqual(
              observed(path === 'puntual' || path === 'suscripción' ? projected : remote)
            );
            return;
          }
          expect(observed(returned)).toEqual(observed(remote));
          if (situation === 'otro paciente' || situation === 'otro episodio') {
            expect(note(stored)).not.toBe(NOTE);
            expect(note(returned)).not.toBe(NOTE);
            expect(returned?.beds.R4.pathology).not.toBe(Q);
          }
        }
      );
    }
  });
}
