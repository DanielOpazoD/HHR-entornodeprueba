/**
 * Synthetic end-to-end harness: the real write service, queue engine, transport and server
 * handler. Only Firestore, Functions, the role and the network state are faked.
 */
import { createRequire } from 'node:module';
import { vi } from 'vitest';
import type { DailyRecord, DailyRecordPatch } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { DataFactory } from '@/tests/factories/DataFactory';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { buildMedicalEntryNoteFields } from '@/domain/handoff/patientEntryMutations';
import { processSyncQueue } from '@/services/storage/sync';
import { readMedicalHandoffDrafts } from '@/services/storage/medicalHandoffDraftStorage';

type Doc = Record<string, unknown>;
interface SpecialistHandler {
  updateSpecialistMedicalHandoff: { run: (data: unknown, context: unknown) => Promise<unknown> };
}
const h = vi.hoisted(() => ({
  remote: null as DailyRecord | null,
  handler: null as SpecialistHandler | null,
  role: 'admin',
  offline: false,
  /** Run the server handler, then lose its response once. */
  loseNextResponse: false,
  callableCalls: 0,
  /** Day tasks publish through the real clinical authority handler instead of a direct write. */
  authorityMode: false,
}));
/** Shared fake state; vi.hoisted bindings cannot be exported directly. */
export const harnessState = () => h;
export const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
const isObject = (value: unknown): value is Doc =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const remoteDoc = () => (h.remote ?? {}) as unknown as Doc;
const mergeDeep = (target: Doc, source: Doc) => {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (value === '__delete__') delete target[key];
    else if (isObject(value) && isObject(current)) mergeDeep(current, value);
    else target[key] = clone(value);
  }
};
const remoteSnapshot = async () => ({
  exists: () => Boolean(h.remote),
  data: () => clone(h.remote),
  metadata: { fromCache: false, hasPendingWrites: false },
});
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  getDoc: vi.fn(() => remoteSnapshot()),
  getDocFromServer: vi.fn(() => remoteSnapshot()),
  runTransaction: vi.fn(async (_db: unknown, run: (transaction: unknown) => unknown) =>
    run({
      get: () => remoteSnapshot(),
      set: (_ref: unknown, data: Doc, options?: { merge?: boolean }) => {
        if (options?.merge && h.remote) mergeDeep(remoteDoc(), data);
        else h.remote = clone(data) as unknown as DailyRecord;
      },
      update: (_ref: unknown, data: Doc) => mergeDeep(remoteDoc(), data),
    })
  ),
  deleteField: () => '__delete__',
}));
vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({}),
}));
vi.mock(
  '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    isServerClinicalWriteFenceActive: async () => false,
    resolveEffectiveDailyRecordAuthorityMode: async () =>
      h.authorityMode ? 'enforced' : 'client_only',
  })
);
vi.mock(
  '@/services/storage/firestore/dailyRecordAuthorityCallableClient',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    saveDailyRecordWithClinicalAuthorityCallable: async (payload: unknown) => {
      const { createAdminMock, createDailyRecordWriteAuthorityFunctions, makeContext } =
        await import('@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support');
      const { admin } = createAdminMock({ remoteData: clone(h.remote) as unknown as Doc });
      const response = await createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: async () => 'admin',
      })
        .saveDailyRecordWithClinicalAuthority.run(payload, makeContext())
        .catch(async (error: unknown) => {
          const { normalizeDailyRecordAuthorityError } =
            await importOriginal<
              typeof import('@/services/storage/firestore/dailyRecordAuthorityCallableClient')
            >();
          throw normalizeDailyRecordAuthorityError(error);
        });
      h.remote = clone(response.recordState.record);
      return response;
    },
  })
);
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: async () => ({}),
    getRegionalFunctions: async () => ({}),
  },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: unknown) => {
    h.callableCalls += 1;
    let result: unknown;
    try {
      const context = {
        auth: { uid: 'synthetic', token: { email: 'specialist@example.invalid' } },
      };
      result = await h.handler?.updateSpecialistMedicalHandoff.run(data, context);
    } catch (error) {
      const failure = error as { message: string; code: string };
      throw Object.assign(new Error(failure.message), { code: `functions/${failure.code}` });
    }
    if (h.loseNextResponse) {
      h.loseNextResponse = false;
      throw Object.assign(new Error('Synthetic lost response'), { code: 'functions/unavailable' });
    }
    return { data: result };
  },
}));
vi.mock('@/utils/networkUtils', async importOriginal => ({
  ...(await importOriginal<object>()),
  withRetry: (operation: () => unknown) => operation(),
}));
vi.mock(
  '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    shouldRouteSpecialistPatchViaCallable: vi.fn(async () => true),
  })
);
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<object>()),
  isFirestoreEnabled: vi.fn(() => !h.offline),
  getFirestoreSyncState: vi.fn(() =>
    h.offline ? { mode: 'local_only', reason: 'offline' } : { mode: 'enabled', reason: 'ready' }
  ),
}));

const require = createRequire(import.meta.url);
const setPath = (target: Doc, path: string, value: unknown) => {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (isObject(next)) current = next;
    else {
      const created: Doc = {};
      current[part] = created;
      current = created;
    }
  }
  current[parts[parts.length - 1]] = value;
};
export const createServerHandler = (): SpecialistHandler => {
  const {
    createSpecialistMedicalHandoffFunctions,
  } = require('../../../../functions/lib/specialistMedicalHandoffFunctions.js');
  return createSpecialistMedicalHandoffFunctions({
    firestore: {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
      runTransaction: async (run: (transaction: unknown) => unknown) => {
        let staged: Record<string, unknown> | undefined;
        const result = await run({
          get: async () => ({ exists: Boolean(h.remote), data: () => clone(h.remote) }),
          update: (_ref: unknown, patch: Record<string, unknown>) => {
            staged = patch;
          },
        });
        for (const [path, value] of Object.entries(staged ?? {})) setPath(remoteDoc(), path, value);
        return result;
      },
    },
    Timestamp: { now: () => '2026-10-24T12:00:00.000Z' },
    resolveRoleForEmail: async () => h.role,
  });
};

export const T0 = '2026-10-24T10:00:00.000Z';
export const patient = (bedId: string, name: string, extra: Partial<PatientData> = {}) =>
  DataFactory.createMockPatient(bedId, {
    patientName: name,
    rut: '99.999.999-9',
    documentType: 'RUT',
    admissionDate: '2026-10-20',
    medicalHandoffNote: '',
    ...extra,
  });
const entry = (id: string) => [{ id, specialty: 'Medicina Interna', note: '' }];
export const A = (bedId = 'R4', extra: Partial<PatientData> = {}) =>
  patient(bedId, 'Paciente A Sintético', {
    clinicalEpisodeId: 'ep-A',
    medicalHandoffEntries: entry('entry-A'),
    ...extra,
  });
export const B = () =>
  patient('R4', 'Paciente B Sintético', { rut: '88.888.888-8', clinicalEpisodeId: 'ep-B' });
/** Specialist notes go only to beds the server enables for them. */
export const C = (extra: Partial<PatientData> = {}) =>
  patient('H1C1', 'Paciente C Sintético', {
    rut: '77.777.777-7',
    clinicalEpisodeId: 'ep-C',
    medicalHandoffEntries: entry('entry-C'),
    ...extra,
  });
export const E = (extra: Partial<PatientData> = {}) =>
  patient('R6', 'Paciente E Sintético', {
    rut: '66.666.666-6',
    clinicalEpisodeId: 'ep-E',
    pathology: 'Dx E',
    ...extra,
  });
export const day = (date: string, beds: Record<string, PatientData>, lastUpdated = T0) =>
  DataFactory.createMockDailyRecord(date, { lastUpdated, beds });

/** The specialist writes one entry through the real write path. */
export const writeNote = async (
  record: DailyRecord,
  bedId: string,
  entryId: string,
  value: string,
  { offline = true }: { offline?: boolean } = {}
) => {
  const occupant = record.beds[bedId];
  const { fields } = buildMedicalEntryNoteFields(occupant, entryId, value, null, record.date, T0);
  const patch = Object.fromEntries(
    Object.entries(fields).map(([field, fieldValue]) => [`beds.${bedId}.${field}`, fieldValue])
  ) as DailyRecordPatch;
  h.offline = offline;
  // The shared Functions loader also checks the browser's own online flag.
  const wasOnline = navigator.onLine;
  Object.defineProperty(navigator, 'onLine', { value: !offline, configurable: true });
  try {
    const result = await updatePartialDetailed(record.date, patch, { baseRecord: record });
    return {
      result,
      record: { ...record, beds: { ...record.beds, [bedId]: { ...occupant, ...fields } } },
    };
  } finally {
    h.offline = false;
    Object.defineProperty(navigator, 'onLine', { value: wasOnline, configurable: true });
  }
};
/** Back online once any pre-outbox hold has expired, as it does on its own in the app. */
export const reconnect = async () => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 60 * 60 * 1000);
  try {
    await processSyncQueue();
    await new Promise(resolve => setTimeout(resolve, 20));
    await processSyncQueue();
  } finally {
    vi.useRealTimers();
  }
};
export const draftsFor = (name: string) =>
  readMedicalHandoffDrafts()
    .filter(draft => draft.patientName === name)
    .map(draft => [draft.date, draft.entryId, draft.value]);
