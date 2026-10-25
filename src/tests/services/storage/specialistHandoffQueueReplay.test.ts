import 'fake-indexeddb/auto';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import { DataFactory } from '@/tests/factories/DataFactory';
const h = vi.hoisted(() => ({
  remote: {} as DailyRecord,
  written: undefined as unknown,
  callable: vi.fn(async (_request: unknown) => ({ data: { success: true } })),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => h.remote })),
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      get: async () => ({ exists: () => true, data: () => h.remote }),
      set: (_ref: unknown, data: unknown) => {
        h.written = data;
      },
    })
  ),
  deleteField: () => '__delete__',
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({}),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  isServerClinicalWriteFenceActive: async () => false,
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getFunctions: async () => ({}) },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => h.callable }));
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { buildSpecialistHandoffTargets } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { hospitalDB } from '@/services/storage/indexedDBService';
import {
  readMedicalHandoffDrafts,
  resetMedicalHandoffDraftMemoryForTests,
} from '@/services/storage/medicalHandoffDraftStorage';

const entries = (note: string) => [{ id: 'entry-A', specialty: 'Medicina Interna', note }];
const makeRecord = () =>
  DataFactory.createMockDailyRecord('2026-10-24', {
    lastUpdated: '2026-10-24T10:00:00.000Z',
    beds: {
      R4: DataFactory.createMockPatient('R4', {
        patientName: 'Paciente A Sintético',
        rut: '99.999.999-9',
        clinicalEpisodeId: 'ep-A',
        medicalHandoffNote: 'Nota de A',
        medicalHandoffEntries: entries('Nota de A'),
      }),
    },
  });
const makeDayTask = (record: DailyRecord): SyncTask => ({
  opId: 'synthetic-op',
  type: 'UPDATE_DAILY_RECORD',
  payload: record,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  origin: 'direct_queue',
  syncContract: {
    changedPaths: ['beds.R4.medicalHandoffNote', 'beds.R4.medicalHandoffEntries'],
    expectedVersion: record.lastUpdated,
    mutationId: 'synthetic-mutation',
  },
});
const notePatch = {
  'beds.R4.medicalHandoffNote': 'Nota de A',
  'beds.R4.medicalHandoffEntries': entries('Nota de A'),
};
const makeHandoffPayload = (record = makeRecord()): SpecialistHandoffSyncPayload => ({
  date: record.date,
  patch: notePatch,
  expectedOccupants: buildSpecialistHandoffTargets(record, notePatch),
});
const makeHandoffTask = (payload = makeHandoffPayload()): SyncTask => ({
  opId: 'synthetic-handoff',
  type: 'UPDATE_SPECIALIST_HANDOFF',
  payload,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  origin: 'direct_queue',
});
const transport = () =>
  createFirestoreSyncTransport({
    getDb: vi.fn<FirestoreServiceRuntimePort['getDb']>(),
    ready: Promise.resolve(),
  });
const draftValues = () => readMedicalHandoffDrafts().map(draft => [draft.patientName, draft.value]);
beforeEach(async () => {
  vi.clearAllMocks();
  resetMedicalHandoffDraftMemoryForTests();
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', 'user:synthetic-specialist');
  await hospitalDB.syncQueue.clear();
  h.remote = makeRecord();
  h.written = undefined;
});

describe('queued handoff preserves the original patient and episode', () => {
  it.each(['turnover', 'readmission', 'passport'])(
    'detaches a note typed before the deploy on %s: nothing reaches the bed, its text stays a draft',
    async scenario => {
      const local = makeRecord();
      h.remote.lastUpdated = '2026-10-24T11:00:00.000Z';
      h.remote.beds.R4.medicalHandoffNote = '';
      h.remote.beds.R4.medicalHandoffEntries = [];
      if (scenario === 'turnover')
        Object.assign(h.remote.beds.R4, {
          patientName: 'Paciente B Sintético',
          clinicalEpisodeId: 'ep-B',
        });
      if (scenario === 'readmission') h.remote.beds.R4.clinicalEpisodeId = 'ep-A2';
      if (scenario === 'passport') h.remote.beds.R4.documentType = 'Pasaporte';
      const task = makeDayTask(local);
      await transport().run(task);
      expect(h.written).toBeUndefined();
      expect(task.payload).toEqual(local);
      expect(draftValues()).toEqual([['Paciente A Sintético', 'Nota de A']]);
    }
  );
  it('still publishes the other edits of a day task whose note lost its patient', async () => {
    const local = makeRecord();
    local.beds.R6 = DataFactory.createMockPatient('R6', {
      patientName: 'Paciente E',
      pathology: 'Dx corregido',
    });
    h.remote.lastUpdated = '2026-10-24T11:00:00.000Z';
    h.remote.beds.R4 = {
      ...h.remote.beds.R4,
      patientName: 'Paciente B Sintético',
      clinicalEpisodeId: 'ep-B',
      medicalHandoffNote: '',
      medicalHandoffEntries: [],
    };
    h.remote.beds.R6 = DataFactory.createMockPatient('R6', {
      patientName: 'Paciente E',
      pathology: 'Dx',
    });
    const task = makeDayTask(local);
    task.syncContract = {
      ...task.syncContract,
      changedPaths: [...(task.syncContract?.changedPaths ?? []), 'beds.R6.pathology'],
    };
    await transport().run(task);
    expect(h.written).toMatchObject({
      beds: {
        R4: { patientName: 'Paciente B Sintético', medicalHandoffNote: '' },
        R6: { pathology: 'Dx corregido' },
      },
    });
    expect(draftValues()).toEqual([['Paciente A Sintético', 'Nota de A']]);
  });
  it('still publishes a legacy task for the unchanged patient', async () => {
    await transport().run(makeDayTask(makeRecord()));
    expect(h.written).toMatchObject({
      beds: { R4: { patientName: 'Paciente A Sintético', medicalHandoffNote: 'Nota de A' } },
    });
  });
  it('replays a specialist note through the occupant-bound callable, never the generic write', async () => {
    const payload = makeHandoffPayload();
    await transport().run(makeHandoffTask(payload));
    expect(h.callable).toHaveBeenCalledWith({
      date: payload.date,
      patch: payload.patch,
      expectedOccupants: payload.expectedOccupants,
    });
    expect(h.written).toBeUndefined();
  });
  it('keeps a refused specialist note as its own conflict and publishes its draft', async () => {
    h.callable.mockRejectedValueOnce(
      Object.assign(new Error('synthetic occupant conflict'), {
        code: 'functions/failed-precondition',
      })
    );
    const task = makeHandoffTask();
    await expect(transport().run(task)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(h.written).toBeUndefined();
    expect(draftValues()).toEqual([['Paciente A Sintético', 'Nota de A']]);
  });
  it('never coalesces a note for another occupant into an unresolved note', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const record = makeRecord();
    const other = {
      ...record,
      beds: {
        R4: { ...record.beds.R4, patientName: 'Paciente B Sintético', clinicalEpisodeId: 'ep-B' },
      },
    };
    await queueDailyRecordSyncTaskWithLocalRecord(record, {}, {}, makeHandoffPayload(record));
    await queueDailyRecordSyncTaskWithLocalRecord(other, {}, {}, makeHandoffPayload(other));
    await queueDailyRecordSyncTaskWithLocalRecord(record, {}, {}, makeHandoffPayload(record));
    const tasks = await hospitalDB.syncQueue.toArray();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    expect(
      tasks.map(
        task => (task.payload as SpecialistHandoffSyncPayload).expectedOccupants[0].patientName
      )
    ).toEqual(['Paciente A Sintético', 'Paciente B Sintético']);
  });
});
