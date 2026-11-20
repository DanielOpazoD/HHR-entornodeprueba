/**
 * Synthetic end-to-end harness: the real write service, queue engine, transport and server
 * handler. Only Firestore, Functions and the network state are faked.
 */
import { vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { DataFactory, asStoredDailyRecordShape } from '@/tests/factories/DataFactory';
import { processSyncQueue } from '@/services/storage/sync';

type Doc = Record<string, unknown>;
const h = vi.hoisted(() => ({
  remote: null as DailyRecord | null,
  offline: false,
  /** Day tasks publish through the real clinical authority handler instead of a direct write. */
  authorityMode: false,
  beforeDayTransaction: null as (() => Promise<void>) | null,
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
  runTransaction: vi.fn(async (_db: unknown, run: (transaction: unknown) => unknown) => {
    if (h.beforeDayTransaction) await h.beforeDayTransaction();
    return run({
      get: () => remoteSnapshot(),
      set: (_ref: unknown, data: Doc, options?: { merge?: boolean }) => {
        if (options?.merge && h.remote) mergeDeep(remoteDoc(), data);
        else h.remote = asStoredDailyRecordShape(clone(data));
      },
      update: (_ref: unknown, data: Doc) => mergeDeep(remoteDoc(), data),
    });
  }),
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
  httpsCallable: (_functions: unknown, name: string) => async () => {
    throw new Error(`Synthetic harness: unexpected callable ${name}`);
  },
}));
vi.mock('@/utils/networkUtils', async importOriginal => ({
  ...(await importOriginal<object>()),
  withRetry: (operation: () => unknown) => operation(),
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<object>()),
  isFirestoreEnabled: vi.fn(() => !h.offline),
  getFirestoreSyncState: vi.fn(() =>
    h.offline ? { mode: 'local_only', reason: 'offline' } : { mode: 'enabled', reason: 'ready' }
  ),
}));

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
/** Days written before the old medical handoff was retired still carry its entries. */
const entry = (id: string) => [{ id, specialty: 'Medicina Interna', note: '' }];
export const A = (bedId = 'R4', extra: Partial<PatientData> = {}) =>
  patient(bedId, 'Paciente A Sintético', {
    clinicalEpisodeId: 'ep-A',
    medicalHandoffEntries: entry('entry-A'),
    ...extra,
  });
export const B = () =>
  patient('R4', 'Paciente B Sintético', { rut: '88.888.888-8', clinicalEpisodeId: 'ep-B' });
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
