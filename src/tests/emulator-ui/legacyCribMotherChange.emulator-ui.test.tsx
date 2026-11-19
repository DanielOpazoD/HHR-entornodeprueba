/**
 * Two provisional newborns of different mothers saved without an episode share one derived
 * `legacy_ep_` id. When the second mother and her newborn reach the bed from the server while a
 * name is being typed for the first newborn, the crib row is a new row: the name is not sent
 * (ID-03, ID-05). Real table, port, queue and authority handlers on the emulator.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { processSyncQueue } from '@/services/storage/sync';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
vi.unmock('@/application/ports/dailyRecordPort');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');

const h = vi.hoisted(() => ({
  db: undefined as unknown,
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async () => {
    throw new Error(`unexpected callable ${name}`);
  },
}));
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return h.db;
  },
  auth: {
    currentUser: {
      uid: 'synthetic-B',
      email: 'synthetic-B@example.invalid',
      isAnonymous: false,
      getIdTokenResult: async () => ({
        claims: { role: 'nurse_hospital' },
      }),
    },
  },
  firebaseReady: Promise.resolve(),
  storage: {},
  functions: {},
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(async () => ({})),
  getRegionalFunctionsInstance: vi.fn(async () => ({})),
  mountConfigWarning: vi.fn(),
}));

import { getTodayISO } from '@/utils/dateCoreUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
const projectId = 'demo-hhr-legacy-crib-mother-change';
const today = getTodayISO();
let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
beforeAll(async () => {
  if (!/^127[.]0[.]0[.]1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
    throw Error('Local emulator only');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = initializeApp({ projectId }, 'legacy-crib-mother-change');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  h.db = env
    .authenticatedContext('synthetic-B', {
      role: 'nurse_hospital',
      email: 'synthetic-B@example.invalid',
    })
    .firestore();
  setFirestoreEnabled(true);
  // Offline: anything the row sends waits in the queue until processSyncQueue below.
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const context = () => ({
    auth: { uid: 'synthetic-B', token: { email: 'synthetic-B@example.invalid' } },
  });
  // Only the callable transport is replaced: the shipped handlers run their real transactions.
  const authorityApi = createDailyRecordWriteAuthorityFunctions({
    firestore: admin,
    Timestamp,
    resolveRoleForEmail: async () => 'nurse_hospital',
  });
  vi.spyOn(authority, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
    async payload => {
      try {
        return await authorityApi.patchDailyRecordWithClinicalAuthority.run(payload, context());
      } catch (error) {
        throw authority.normalizeDailyRecordAuthorityError(error);
      }
    }
  );
  vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
    async payload => {
      try {
        return await authorityApi.saveDailyRecordWithClinicalAuthority.run(payload, context());
      } catch (error) {
        throw authority.normalizeDailyRecordAuthorityError(error);
      }
    }
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await env?.cleanup();
  await deleteApp(app);
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ensurePatientClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { buildCensusBedRows } from '@/features/census/controllers/censusTableViewController';
import { DEFAULT_COLUMN_WIDTHS } from '@/services/storage/tableConfigService';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { UIProvider } from '@/context/UIContext';
import { AuditProvider } from '@/context/AuditContext';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { BEDS } from '@/constants/beds';
vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({ professionalsCatalog: [] }),
}));
vi.mock('@/context/AuthContext', () => ({
  useCanEdit: () => true,
  useAuth: () => ({
    role: 'nurse_hospital',
    isEditor: true,
    remoteSyncStatus: 'ready',
    currentUser: {
      uid: 'synthetic-B',
      email: 'synthetic-B@example.invalid',
      role: 'nurse_hospital',
    },
  }),
}));
vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ checkVersion: vi.fn(), checkRuntimeContract: vi.fn() }),
}));
const bed = BEDS.find(b => b.id === 'R1')!;
const date = today;
const provisionalNewborn = () =>
  ensurePatientClinicalEpisodeId(
    DataFactory.createMockPatient(bed.id, {
      patientName: 'RN PROVISIONAL SINTETICO',
      firstName: '',
      lastName: '',
      secondLastName: '',
      rut: '',
      identityStatus: 'provisional',
      clinicalEpisodeId: undefined,
      admissionDate: date,
      firstSeenDate: date,
      admissionTime: '07:20',
    })
  );

/** The census as the app wires it: the real day hook, provider, bed row and its crib row. */
const Census = () => {
  const day = useDailyRecord(date, 'ready');
  if (!day.record) return null;
  const record = day.record;
  const { unifiedRows } = buildCensusBedRows({ visibleBeds: [bed], beds: record.beds });
  return (
    <DailyRecordProvider value={day}>
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString={date}
          recordLastUpdated={record.lastUpdated}
          readOnly={false}
          columns={DEFAULT_COLUMN_WIDTHS}
          visibleColumnCount={12}
          bedTypes={{ [bed.id]: bed.type }}
          role="nurse_hospital"
          diagnosisMode="free"
          clinicalDocumentPresenceByBedId={{}}
          onAction={() => {}}
          onActivateEmptyBed={() => {}}
        />
      </table>
    </DailyRecordProvider>
  );
};

it('keeps the second newborn name when another mother arrives from the server while a name is typed', async () => {
  await env.clearFirestore();
  await clearSessionScopedClientState('manual');
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
  await admin
    .doc('hospitals/hanga_roa/settings/rayenImportPolicy')
    .set({ schemaVersion: 2, clinicalBatchMode: 'enforced' });
  const path = 'hospitals/hanga_roa/dailyRecords/' + date;
  const seed = DataFactory.createMockDailyRecord(date, {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'MADRE SINTETICA',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'ep_madre_a',
        firstSeenDate: date,
        admissionDate: date,
        clinicalCrib: provisionalNewborn(),
      }),
    },
    lastUpdated: new Date(Date.now() - 120000).toISOString(),
    dateTimestamp: clinicalWallClockToDate(date, '00:00').getTime(),
  });
  const before = JSON.parse(JSON.stringify(seed));
  await admin.doc(path).set(before);
  await hospitalDB.dailyRecords.put(before);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <UIProvider>
        <AuditProvider>
          <DefaultRepositoryProvider>
            <Census />
          </DefaultRepositoryProvider>
        </AuditProvider>
      </UIProvider>
    </QueryClientProvider>
  );
  try {
    const input = await screen.findByPlaceholderText('Nombre RN / Niño', {}, { timeout: 10000 });
    const replacement = {
      ...before.beds.R1,
      patientName: 'SEGUNDA MADRE SINTETICA',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'ep_madre_b',
      clinicalCrib: provisionalNewborn(),
    };
    expect(before.beds.R1.clinicalCrib.clinicalEpisodeId).toMatch(/^legacy_ep_/);
    expect(replacement.clinicalCrib.clinicalEpisodeId).toBe(
      before.beds.R1.clinicalCrib.clinicalEpisodeId
    );
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'NOMBRE DEL PRIMER RN' } });
    await act(async () => {
      await admin.doc(path).update({
        'beds.R1': JSON.parse(JSON.stringify(replacement)),
        lastUpdated: new Date().toISOString(),
      });
    });
    await screen.findByText('SEGUNDA MADRE SINTETICA', {}, { timeout: 10000 });
    fireEvent.blur(screen.getByPlaceholderText('Nombre RN / Niño'));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await processSyncQueue();
    });
    const saved = (await admin.doc(path).get()).data()!.beds.R1;
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    expect(saved.clinicalEpisodeId).toBe('ep_madre_b');
    expect(saved.clinicalCrib.patientName).toBe('RN PROVISIONAL SINTETICO');
  } finally {
    view.unmount();
    client.clear();
  }
}, 30000);
