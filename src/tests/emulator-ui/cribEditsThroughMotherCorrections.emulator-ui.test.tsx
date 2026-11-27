/**
 * Corrections to the same mother never drop what is being typed for her newborn, and the newborn
 * name keeps its focus across its own autosave (ID-05). Only accredited episodes key the crib row:
 * a mother or newborn without one (a `legacy_ep_` id follows editable fields) keeps the row as it
 * was. Two newborns of different legacy mothers with the same provisional name and hour are the
 * documented limit of ID-05 and are not tested here. Real table, port, queue and authority handlers.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { processSyncQueue } from '@/services/storage/sync';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/session/sessionScopedStorageService';
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
vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
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
const projectId = 'demo-hhr-crib-mother-corrections';
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
  app = initializeApp({ projectId }, 'crib-mother-corrections');
  admin = getFirestore(app);
  admin.settings({ ignoreUndefinedProperties: true });
  h.db = env
    .authenticatedContext('synthetic-B', {
      role: 'nurse_hospital',
      email: 'synthetic-B@example.invalid',
    })
    .firestore();
  setFirestoreEnabled(true);
  // Offline for the queue's own wake-up: a cell edit is sent straight to the server, and anything
  // kept in the queue would only be sent by the processSyncQueue in settle().
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

import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ensurePatientClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { buildCensusBedRows } from '@/features/census/controllers/censusTableViewController';
import { DEFAULT_COLUMN_WIDTHS } from '@/services/storage/tableConfigService';
import { DefaultRepositoryProvider } from '@/context/RepositoryContext';
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
      <output data-testid="subscription">{JSON.stringify(record.beds.R1)}</output>
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
          clinicalDocumentPresenceByBedId={{}}
          onAction={() => {}}
          onActivateEmptyBed={() => {}}
        />
      </table>
    </DailyRecordProvider>
  );
};

const path = 'hospitals/hanga_roa/dailyRecords/' + date;
const typed = { patientName: 'NOMBRE RN SINTETICO', pathology: 'BORRADOR DIAGNOSTICO RN' };
const getName = () => screen.getByPlaceholderText('Nombre RN / Niño') as HTMLInputElement;
async function start(motherLegacy: boolean, newbornLegacy = true) {
  await env.clearFirestore();
  await clearSessionScopedClientState('manual');
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
  await admin
    .doc('hospitals/hanga_roa/settings/rayenImportPolicy')
    .set({ schemaVersion: 2, clinicalBatchMode: 'enforced' });
  const crib = provisionalNewborn();
  if (!newbornLegacy) crib.clinicalEpisodeId = 'ep_rn_sintetico';
  crib.pathology = 'DX INICIAL RN';
  const mother = ensurePatientClinicalEpisodeId(
    DataFactory.createMockPatient('R1', {
      patientName: 'MADRE SINTETICA',
      rut: '11.111.111-1',
      clinicalEpisodeId: motherLegacy ? undefined : 'ep_madre_a',
      firstSeenDate: date,
      admissionDate: date,
      admissionTime: '05:40',
      pathology: 'DX INICIAL MADRE',
      clinicalCrib: crib,
    })
  );
  const seed = DataFactory.createMockDailyRecord(date, {
    // A whole day, as the server stores it: a retry rebased on a newer version keeps its beds.
    beds: { ...DataFactory.createMockDailyRecord(date).beds, R1: mother },
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
  await screen.findByPlaceholderText('Nombre RN / Niño', {}, { timeout: 10000 });
  return {
    mother,
    crib,
    stop() {
      view.unmount();
      client.clear();
    },
  };
}
const toLastUpdatedMillis = (value: unknown): number => {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

async function push(changes: Record<string, unknown>) {
  const patch = Object.fromEntries(Object.entries(changes).map(([k, v]) => ['beds.R1.' + k, v]));
  await act(async () => {
    // Serialize with any concurrent debounced authority transaction so the external mother
    // correction always advances `lastUpdated` monotonically instead of inverting timestamps.
    await admin.runTransaction(async transaction => {
      const ref = admin.doc(path);
      const snapshot = await transaction.get(ref);
      const currentMillis = toLastUpdatedMillis(snapshot.data()?.lastUpdated);
      const nextLastUpdated = new Date(Math.max(Date.now(), currentMillis + 1)).toISOString();
      transaction.update(ref, { ...patch, lastUpdated: nextLastUpdated });
    });
  });
  await waitFor(
    () => {
      const received = JSON.parse(screen.getByTestId('subscription').textContent!);
      for (const [k, v] of Object.entries(changes)) expect(received[k]).toEqual(v);
    },
    { timeout: 10_000 }
  );
}
/**
 * Waits, within a bounded time, until the server shows the mother's correction and the newborn's
 * edit together and the queue is empty, then returns the bed as the server stores it. The cell
 * sends its edit after its own pause and the write's receipt can still be on its way, so a single
 * read after a fixed pause can see the previous value on a slow runner (main behaves the same).
 */
async function settle(expected: {
  mother?: Record<string, unknown>;
  newborn: Record<string, unknown>;
}) {
  let saved: (Record<string, unknown> & { clinicalCrib: Record<string, unknown> }) | undefined;
  await waitFor(
    async () => {
      await processSyncQueue();
      saved = (await admin.doc(path).get()).data()!.beds.R1;
      for (const [key, value] of Object.entries(expected.mother ?? {})) {
        expect(saved![key]).toBe(value);
      }
      for (const [key, value] of Object.entries(expected.newborn)) {
        expect(saved!.clinicalCrib[key]).toBe(value);
      }
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    },
    { timeout: 10_000 }
  );
  return saved!;
}
const corrections = {
  pathology: 'DX MATERNO CORREGIDO',
  specialty: 'Cirugía',
  age: '31',
  rut: '12.345.678-5',
  patientName: 'MADRE SINTETICA CORREGIDA',
};
for (const [legacy, newbornLegacy] of [
  [true, true],
  [false, true],
  [true, false],
]) {
  for (const field of ['patientName', 'pathology'] as const) {
    for (const [maternalField, value] of Object.entries(corrections)) {
      if (!newbornLegacy && !['rut', 'patientName'].includes(maternalField)) continue;
      it(`keeps the ${field} typed for a ${newbornLegacy ? 'legacy' : 'accredited'} newborn when its ${legacy ? 'legacy' : 'accredited'} mother's ${maternalField} is corrected`, async () => {
        const c = await start(legacy, newbornLegacy);
        try {
          const original = getName();
          if (field === 'patientName') {
            act(() => original.focus());
            fireEvent.change(original, { target: { value: typed[field] } });
          } else {
            const editor = within(original.closest('tr')!).getByPlaceholderText(
              'Diagnóstico (texto libre)'
            );
            act(() => editor.focus());
            fireEvent.change(editor, { target: { value: typed[field] } });
          }
          await push({ [maternalField]: value });
          const retained = original === getName();
          const saved = await settle({
            mother: { [maternalField]: value },
            newborn: { [field]: typed[field] },
          });
          const queue = await hospitalDB.syncQueue.count();
          expect(saved[maternalField]).toBe(value);
          expect(retained).toBe(true);
          expect(saved.clinicalCrib[field]).toBe(typed[field]);
          expect(queue).toBe(0);
        } finally {
          c.stop();
        }
      });
    }
  }
}
it.each([true, false])(
  'keeps typing the newborn name after its first autosave (legacy newborn: %s)',
  async legacy => {
    const c = await start(true, legacy);
    try {
      const user = userEvent.setup();
      const original = getName();
      act(() => original.focus());
      original.select();
      await user.keyboard('RN LUNA');
      await waitFor(
        () =>
          expect(
            JSON.parse(screen.getByTestId('subscription').textContent!).clinicalCrib.patientName
          ).toBe('RN LUNA'),
        { timeout: 4000 }
      );
      const focused = getName() === document.activeElement;
      await user.keyboard(' DEL MAR');
      const saved = await settle({ newborn: { patientName: 'RN LUNA DEL MAR' } });
      const queue = await hospitalDB.syncQueue.count();
      expect(queue).toBe(0);
      expect(saved.clinicalCrib.patientName).toBe('RN LUNA DEL MAR');
      expect(focused).toBe(true);
    } finally {
      c.stop();
    }
  }
);
it('keeps the newborn diagnosis being typed when only the dots of its legacy mother RUT are removed', async () => {
  const c = await start(true);
  try {
    const input = within(getName().closest('tr')!).getByPlaceholderText(
      'Diagnóstico (texto libre)'
    );
    act(() => input.focus());
    fireEvent.change(input, { target: { value: typed.pathology } });
    const formatted = c.mother.rut.replaceAll('.', '');
    await push({ rut: formatted });
    const saved = await settle({
      mother: { rut: formatted },
      newborn: { pathology: typed.pathology },
    });
    const queue = await hospitalDB.syncQueue.count();
    expect(queue).toBe(0);
    expect(saved.clinicalCrib.pathology).toBe(typed.pathology);
  } finally {
    c.stop();
  }
});
