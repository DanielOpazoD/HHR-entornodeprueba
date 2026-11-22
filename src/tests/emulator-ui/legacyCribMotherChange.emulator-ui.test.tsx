/**
 * A provisional newborn, then another mother (accredited episode) and her newborn in the same bed
 * (ID-03, ID-05). Real table, port, queue and authority handlers on the emulator.
 *
 * - The name typed for the first newborn is still in the cell when the new mother arrives: the
 *   crib row is a new row and the name is never sent, even when both newborns are legacy and
 *   share one derived `legacy_ep_` id.
 * - The name has already left the cell and reaches the server after the new mother: with
 *   accredited newborns it never reaches the new one. With legacy newborns of the same derived id
 *   it can, once retried on the new version: the known limit of ID-05 (as in main), kept here as
 *   an expected failure.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { doc, getDocFromCache, type Firestore as ClientFirestore } from 'firebase/firestore';
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
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/services/repositories/dailyRecordRepositoryWriteService')
    >();
  return {
    ...actual,
    updatePartialDetailed: async (...args: Parameters<typeof actual.updatePartialDetailed>) => {
      h.writesInFlight += 1;
      try {
        return await actual.updatePartialDetailed(...args);
      } finally {
        h.writesInFlight -= 1;
      }
    },
  };
});

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  /** While set, a bed patch waits here before reaching the authority. */
  holdPatch: null as Promise<void> | null,
  patchCalls: 0,
  /** Bed patches sent to the authority in this test, and those it accepted. */
  sent: [] as string[],
  accepted: [] as string[],
  /** Census writes started and not finished (retries included). */
  writesInFlight: 0,
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
      h.patchCalls += 1;
      h.sent.push(JSON.stringify(payload));
      if (h.holdPatch) await h.holdPatch;
      try {
        const answer = await authorityApi.patchDailyRecordWithClinicalAuthority.run(
          payload,
          context()
        );
        h.accepted.push(JSON.stringify(payload));
        return answer;
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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const provisionalNewborn = (clinicalEpisodeId?: string) =>
  ensurePatientClinicalEpisodeId(
    DataFactory.createMockPatient(bed.id, {
      patientName: 'RN PROVISIONAL SINTETICO',
      firstName: '',
      lastName: '',
      secondLastName: '',
      rut: '',
      identityStatus: 'provisional',
      clinicalEpisodeId,
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

const path = `hospitals/hanga_roa/dailyRecords/${date}`;
const TYPED = 'NOMBRE DEL PRIMER RN';
const SECOND_NEWBORN_NAME = 'NOMBRE DEL SEGUNDO RN';

/**
 * Bed R1 holds mother A (accredited) and her provisional newborn; `replace` puts mother B and her
 * newborn in the bed on the server. Newborn episodes are legacy unless given.
 */
const renderBed = async (newbornEpisodes: { first?: string; second?: string } = {}) => {
  await env.clearFirestore();
  await clearSessionScopedClientState('manual');
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
  await admin
    .doc('hospitals/hanga_roa/settings/rayenImportPolicy')
    .set({ schemaVersion: 2, clinicalBatchMode: 'enforced' });
  h.patchCalls = 0;
  h.holdPatch = null;
  h.sent = [];
  h.accepted = [];
  h.writesInFlight = 0;
  const seed = DataFactory.createMockDailyRecord(date, {
    beds: {
      ...DataFactory.createMockDailyRecord(date).beds,
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'MADRE SINTETICA',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'ep_madre_a',
        firstSeenDate: date,
        admissionDate: date,
        clinicalCrib: provisionalNewborn(newbornEpisodes.first),
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
  const input = await screen.findByPlaceholderText('Nombre RN / Niño', {}, { timeout: 10000 });
  const replacement = {
    ...before.beds.R1,
    patientName: 'SEGUNDA MADRE SINTETICA',
    rut: '12.345.678-5',
    clinicalEpisodeId: 'ep_madre_b',
    clinicalCrib: provisionalNewborn(newbornEpisodes.second),
  };
  return {
    input,
    firstNewborn: before.beds.R1.clinicalCrib as { clinicalEpisodeId: string },
    replacement,
    replace: () =>
      act(async () => {
        await admin.doc(path).update({
          'beds.R1': JSON.parse(JSON.stringify(replacement)),
          lastUpdated: new Date().toISOString(),
        });
      }),
    stored: async () => (await admin.doc(path).get()).data()!.beds.R1,
    stop: () => {
      view.unmount();
      client.clear();
      h.holdPatch = null;
    },
  };
};

/**
 * Holds the name cell's own 350 ms pause (and only it) until `release`: the replacement then
 * arrives, for certain, while the typed name is still in the cell. A pause the cell cancels is
 * dropped; one still held at release runs as the cell would have run it.
 */
const holdCellPause = () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const held = new Map<object, () => void>();
  const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== 350) return realSetTimeout(callback, delay, ...args);
    const handle = {};
    held.set(handle, callback);
    return handle;
  }) as typeof setTimeout);
  const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
    handle?: Parameters<typeof clearTimeout>[0]
  ) => {
    if (handle && typeof handle === 'object' && held.delete(handle)) return;
    realClearTimeout(handle);
  }) as typeof clearTimeout);
  return {
    release: () => {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      const pending = [...held.values()];
      held.clear();
      act(() => pending.forEach(callback => callback()));
      return pending.length;
    },
  };
};

it('keeps the second newborn name when another mother arrives from the server while a name is typed', async () => {
  const bedView = await renderBed();
  try {
    expect(bedView.firstNewborn.clinicalEpisodeId).toMatch(/^legacy_ep_/);
    expect(bedView.replacement.clinicalCrib.clinicalEpisodeId).toBe(
      bedView.firstNewborn.clinicalEpisodeId
    );
    const pause = holdCellPause();
    act(() => bedView.input.focus());
    fireEvent.change(bedView.input, { target: { value: TYPED } });
    await bedView.replace();
    await screen.findByText('SEGUNDA MADRE SINTETICA', {}, { timeout: 10000 });
    fireEvent.blur(screen.getByPlaceholderText('Nombre RN / Niño'));
    // The new crib row dropped the old cell and its pause: nothing is left to run.
    expect(pause.release()).toBe(0);

    // A name typed for the second newborn is written after anything the first cell sent (one
    // day's writes go in order): once the server has it, nothing else is on its way.
    const current = screen.getByPlaceholderText('Nombre RN / Niño');
    act(() => current.focus());
    fireEvent.change(current, { target: { value: SECOND_NEWBORN_NAME } });
    fireEvent.blur(current);
    await waitFor(
      async () => {
        await processSyncQueue();
        const saved = await bedView.stored();
        expect(saved.clinicalEpisodeId).toBe('ep_madre_b');
        expect(saved.clinicalCrib.patientName).toBe(SECOND_NEWBORN_NAME);
        expect(await hospitalDB.syncQueue.count()).toBe(0);
      },
      { timeout: 10000 }
    );
    expect(h.sent.filter(patch => patch.includes(TYPED))).toEqual([]);
  } finally {
    bedView.stop();
  }
}, 30000);

/**
 * The name has left the cell (its pause ended) and its write reaches the server only after the
 * new mother and newborn are stored there and this computer's listener has them.
 */
const sentBeforeBedChanges = async (newbornEpisodes?: { first?: string; second?: string }) => {
  const bedView = await renderBed(newbornEpisodes);
  let releasePatch!: () => void;
  h.holdPatch = new Promise<void>(resolve => {
    releasePatch = resolve;
  });
  const pause = holdCellPause();
  try {
    act(() => bedView.input.focus());
    fireEvent.change(bedView.input, { target: { value: TYPED } });
    expect(pause.release()).toBe(1);
    await waitFor(() => expect(h.patchCalls).toBe(1), { timeout: 10000 });
    await bedView.replace();
    // This computer's Firestore listener has the new day (the census itself keeps its copy while
    // the write is in flight, SAVE-01).
    await waitFor(
      async () => {
        const cached = await getDocFromCache(doc(h.db as ClientFirestore, path));
        expect(cached.data()?.beds?.R1?.clinicalEpisodeId).toBe('ep_madre_b');
      },
      { timeout: 10000 }
    );
    h.holdPatch = null;
    releasePatch();

    // The write, with any retry on the new version, has finished.
    await waitFor(() => expect(h.writesInFlight).toBe(0), { timeout: 10000 });
    await act(async () => {
      await processSyncQueue();
    });
    const saved = await bedView.stored();
    expect(saved.clinicalEpisodeId).toBe('ep_madre_b');
    expect(saved.clinicalCrib.patientName).toBe('RN PROVISIONAL SINTETICO');
    expect(h.accepted.filter(patch => patch.includes(TYPED))).toEqual([]);
  } finally {
    releasePatch();
    h.holdPatch = null;
    pause.release();
    bedView.stop();
  }
};

it('does not put a name already sent for an accredited newborn on the newborn of another mother', async () => {
  await sentBeforeBedChanges({ first: 'ep_rn_a', second: 'ep_rn_b' });
}, 30000);

// ID-05 known limit, as in main: once the name has left the cell, a write retried on the new
// version reaches the next legacy newborn with the same derived id. Production cribs carry
// accredited episodes (Oct–Nov 2026: 26 of 26); with them the case above refuses it.
it.fails(
  'does not put a name already sent for a legacy newborn on the newborn of another mother',
  async () => {
    await sentBeforeBedChanges();
  },
  30000
);
