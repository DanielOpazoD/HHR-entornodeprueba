import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  A,
  B,
  clone,
  createServerHandler,
  day,
  harnessState,
  reconnect,
  writeNote,
} from './specialistHandoffOutboxHarness';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
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
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import {
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
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
  getRecordsRangeFromFirestore: async () =>
    harnessState().remote ? [clone(harnessState().remote)] : [],
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
type Path = 'puntual' | 'suscripción' | 'rango' | 'mantenimiento' | 'JSON' | 'heredada' | 'E' | 'A';
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
  vi.spyOn(Date, 'now').mockReturnValue(1792843200000);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
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

let lastMeta: unknown;
async function read(path: Path, remote: DailyRecord | null) {
  if (path === 'A') {
    lastMeta = null;
    return remote
      ? adoptAuthoritativeRecord(remote)
      : ((await hospitalDB.dailyRecords.get(DATE)) ?? null);
  }
  if (path === 'E') {
    const result = await syncWithFirestoreDetailed(DATE);
    lastMeta = result && [result.serverConfirmed, result.sourceOfTruth, result.consistencyState];
    return result?.record;
  }
  if (path === 'puntual') {
    const r = await getForDateWithMeta(DATE);
    lastMeta = [r.serverConfirmed, r.sourceOfTruth, r.consistencyState];
    return r.record;
  }
  if (path === 'rango' || path === 'mantenimiento') {
    lastMeta = null;
    return (
      (await (path === 'rango' ? syncRecordsRange : hydrateRangeRecords)(DATE, DATE))[0] ?? null
    );
  }
  return new Promise<DailyRecord | null>((resolve, reject) => {
    const stop = subscribeDetailed(
      DATE,
      result => {
        lastMeta = [result.serverConfirmed, result.sourceOfTruth, result.consistencyState];
        stop();
        resolve(result.record);
      },
      () => reject(new Error('Subscription failed'))
    );
    wire.emit!(clone(remote) as DailyRecord, false, {
      fromCache: h.offline,
      hasPendingWrites: false,
    });
  });
}
import { appendFileSync } from 'node:fs';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import * as firebase from 'firebase/firestore';
const obs = (x: object) => {
  if (process.env.DIFF_OUTPUT) appendFileSync(process.env.DIFF_OUTPUT, JSON.stringify(x) + '\n');
};
for (const path of ['suscripción', 'E', 'puntual', 'rango', 'mantenimiento', 'A'] as const) {
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
    'FAILED',
    'CONFLICT',
    'released',
    'quarantined',
    'noTasks',
    'missing',
    'unavailable',
    'ACKshort',
    'ACKlong',
  ] as const) {
    it(`${path} ${scenario}`, async () => {
      let { remote } = await prepare('especialista');
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
            {
              'beds.R4.clinicalCrib.medicalHandoffEntries': fields.medicalHandoffEntries,
              'beds.R4.clinicalCrib.medicalHandoffNote': fields.medicalHandoffNote,
              'beds.R4.clinicalCrib.medicalHandoffAudit': fields.medicalHandoffAudit,
            } as DailyRecordPatch,
            { baseRecord: remote }
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

      h.remote = remote;
      if (['FAILED', 'CONFLICT', 'released', 'quarantined'].includes(scenario)) {
        const [task] = await hospitalDB.syncQueue.toArray();
        await hospitalDB.syncQueue.update(
          task.id!,
          scenario === 'released'
            ? { projectionReleased: true }
            : {
                status: scenario === 'quarantined' ? 'FAILED' : (scenario as 'FAILED' | 'CONFLICT'),
              }
        );
      }
      if (scenario === 'noTasks') {
        await hospitalDB.syncQueue.clear();
        await hospitalDB.dailyRecords.clear();
      }
      if (scenario === 'ACKshort' || scenario === 'ACKlong') {
        await read(path, remote);
        h.handler = createServerHandler();
        await reconnect();
        remote = clone(h.remote!);
        const text =
          scenario === 'ACKshort'
            ? 'Texto confirmado posterior'
            : 'Texto confirmado posterior de otro especialista que es bastante más largo que la nota anterior';
        remote.beds.R4.medicalHandoffNote = text;
        remote.beds.R4.medicalHandoffEntries![0].note = text;
        remote.lastUpdated = '2026-10-24T16:00:00.000Z';
        h.remote = remote;
      }
      if (scenario === 'missing' || scenario === 'unavailable') h.remote = null;
      const put = vi.spyOn(hospitalDB.dailyRecords, 'put'),
        bulk = vi.spyOn(hospitalDB.dailyRecords, 'bulkPut');
      const event = vi.fn();
      window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
      const reads = [];
      try {
        for (let i = 0; i < 5; i++) {
          put.mockClear();
          bulk.mockClear();
          event.mockClear();
          if (
            scenario === 'unavailable' &&
            (path === 'E' || path === 'suscripción' || path === 'puntual')
          ) {
            if (path === 'E')
              vi.mocked(firebase.getDoc).mockRejectedValueOnce(new Error('Synthetic unavailable'));
            else h.offline = true;
          }
          const out = await read(path, h.remote);
          reads.push({
            out,
            stored: await hospitalDB.dailyRecords.get(DATE),
            writes: put.mock.calls.length + bulk.mock.calls.length,
            events: event.mock.calls.length,
            meta: lastMeta,
          });
        }
      } finally {
        window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, event);
      }
      obs({ path, scenario, reads });
    });
  }
}
