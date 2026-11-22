/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import {
  buildAtomicPatientMovementPatch,
  resolveAddDischargeMovement,
} from '@/application/census/public';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { BEDS } from '@/constants/beds';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

/**
 * The browser tab closes with a census change in this computer's queue, and the person opens the
 * app again (SAVE-01, SAVE-03). Two moments: the change was saved without network and the tab
 * closed before the network came back, or the tab closed while the queue was sending it and the
 * server never received it. A reload is a new copy of every module (memory, session generation,
 * queue worker, write lock) over the same IndexedDB and localStorage, so each tab here is a fresh
 * module graph; the person signs in again as on startup. Everything else is the shipped code
 * against the Firestore emulator under the production configuration, with only the callable's
 * network hop replaced by the shipped authority handler.
 */

// One SDK per person, bound to the async chain that writes, as in syncQueueModel.
const { scope } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return { scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string }>() };
});
vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  get db() {
    return scope.getStore()?.db;
  },
  auth: {
    get currentUser() {
      const actor = scope.getStore();
      return actor
        ? {
            uid: actor.uid,
            email: `${actor.uid}@example.invalid`,
            displayName: 'Persona sintética',
            isAnonymous: false,
            getIdTokenResult: async () => ({ claims: { role: actor.role } }),
          }
        : null;
    },
  },
  storage: {},
  functions: {},
  firebaseReady: Promise.resolve(),
  getStorageInstance: vi.fn(),
  getFunctionsInstance: vi.fn(),
  mountConfigWarning: vi.fn(),
}));

// The callable's network hop: the shipped client and its checks run in every tab, then the
// shipped handler commits with the real admin transaction. `cut` stands for the tab closing
// while the request is on its way: it never reaches the server.
const server = vi.hoisted(() => ({
  dispatched: 0,
  cut: undefined as undefined | (() => void),
  api: undefined as
    | undefined
    | Record<
        'saveDailyRecordWithClinicalAuthority' | 'patchDailyRecordWithClinicalAuthority',
        { run: (payload: unknown, context: unknown) => Promise<unknown> }
      >,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityTransport', async () => {
  const { normalizeDailyRecordAuthorityError } =
    await import('@/services/storage/firestore/dailyRecordAuthorityCallableClient');
  return {
    invokeAuthority: async (operation: 'save' | 'patch', payload: unknown, check: () => void) => {
      check();
      const cut = server.cut;
      if (cut) {
        server.cut = undefined;
        cut();
        return new Promise<never>(() => undefined);
      }
      server.dispatched++;
      const uid = scope.getStore()?.uid;
      try {
        return await server.api?.[`${operation}DailyRecordWithClinicalAuthority`].run(payload, {
          auth: { uid, token: { email: `${uid}@example.invalid` } },
        });
      } catch (error) {
        throw normalizeDailyRecordAuthorityError(error);
      }
    },
  };
});

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-queue-across-tab-restart';
const OWNER = 'user:synthetic-P1';
const ANA = { patientName: 'ANA SINTETICA', rut: '12.345.678-5' };
const DIAGNOSIS = 'DIAGNOSTICO ESCRITO ANTES DEL REINICIO';

const baseRecord = (): DailyRecord =>
  ({
    ...DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-01-01T00:00:00.000Z',
      dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      beds: {
        ...DataFactory.createMockDailyRecord(date).beds,
        R1: DataFactory.createMockPatient('R1', {
          ...ANA,
          admissionDate: date,
          clinicalEpisodeId: 'synthetic-episode-R1',
          pathology: 'DIAGNOSTICO BASE',
          age: '40',
        }),
      },
    }),
    meta: { revision: 1 },
  }) as DailyRecord;

/** The census's own patches: the diagnosis cell, and «Dar de alta» with its freed bed. */
const changes = {
  diagnosis: (record: DailyRecord): DailyRecordPatch =>
    bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'pathology',
      value: DIAGNOSIS,
    }) ?? {},
  discharge: (record: DailyRecord): DailyRecordPatch => {
    const resolution = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        type: 'Domicilio (Habitual)',
        time: '10:00',
        dischargeTarget: 'both',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });
    if (!resolution.ok) throw new Error(`discharge not resolved: ${resolution.error.code}`);
    return buildAtomicPatientMovementPatch({
      updatedRecord: resolution.value.updatedRecord,
      movementKey: 'discharges',
      sourceBedIds: ['R1'],
    });
  },
};
type Change = keyof typeof changes;
/** What the census shows for each change once it is saved. */
const shownChange = (record: DailyRecord | undefined, change: Change) =>
  change === 'diagnosis'
    ? record?.beds.R1.pathology
    : {
        discharged: (record?.discharges ?? [])
          .filter(item => !(item as { deleted?: boolean }).deleted)
          .map(item => item.patientName),
        bed: record?.beds.R1.patientName,
      };
const expectedShown = (change: Change) =>
  change === 'diagnosis' ? DIAGNOSIS : { discharged: [ANA.patientName], bed: '' };

/** One browser tab: its own copy of every module, over the shared IndexedDB and localStorage. */
const openTab = async () => {
  vi.resetModules();
  const { hospitalDB } = await import('@/services/storage/indexeddb/indexedDbCore');
  const repo = await import('@/services/repositories/dailyRecordRepositoryWriteService');
  const session = await import('@/services/session/authoringSession');
  const sync = await import('@/services/storage/sync');
  const scoped = await import('@/services/session/sessionScopedStorageService');
  const config = await import('@/services/repositories/repositoryConfig');
  return {
    hospitalDB,
    updatePartialDetailed: repo.updatePartialDetailed,
    captureAuthoringSession: session.captureAuthoringSession,
    processSyncQueue: sync.processSyncQueue,
    getSyncQueueTelemetry: sync.getSyncQueueTelemetry,
    reconcileAuthorizedSessionOwner: scoped.reconcileAuthorizedSessionOwner,
    setFirestoreSyncState: config.setFirestoreSyncState,
    setFirestoreEnabled: config.setFirestoreEnabled,
  };
};
type Tab = Awaited<ReturnType<typeof openTab>>;

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('a census change in the queue when the tab closes', () => {
  let env: RulesTestEnvironment;
  let app: App;
  let admin: Firestore;
  let computer: { db: unknown; uid: string; role: string };
  let tab: Tab;
  const asP1 = <T>(action: () => T): T => scope.run(computer, action);
  const readServer = async (): Promise<DailyRecord> => {
    const data = (await admin.doc(dayPath).get()).data();
    if (!data) throw new Error('Synthetic census missing');
    const stamp = data.lastUpdated;
    return docToRecord(
      { ...data, lastUpdated: stamp instanceof Timestamp ? stamp.toDate().toISOString() : stamp },
      date
    );
  };
  /** The queue over the next half hour, past any retry wait or a closed tab's claim. */
  const runQueue = async () => {
    const now = Date.now;
    for (let round = 1; round <= 3; round++) {
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + round * 10 * 60_000);
      try {
        await asP1(() => tab.processSyncQueue());
      } finally {
        clock.mockRestore();
      }
    }
  };

  beforeAll(async () => {
    const endpoint = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(
      process.env.FIRESTORE_EMULATOR_HOST ?? ''
    );
    if (!endpoint) throw new Error('A loopback Firestore emulator is required');
    env = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: endpoint[1],
        port: Number(endpoint[2]),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
    app = initializeApp({ projectId }, 'queue-across-tab-restart');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    server.api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin,
      Timestamp,
      resolveRoleForEmail: async () => 'nurse_hospital',
    });
    computer = {
      uid: 'synthetic-P1',
      role: 'nurse_hospital',
      db: env
        .authenticatedContext('synthetic-P1', {
          email: 'synthetic-P1@example.invalid',
          role: 'nurse_hospital',
        })
        .firestore(),
    };
    // What production runs since 2026-11-07: the schema-v2 policy with enforced clinical batches.
    // The queue runs only when the test says so: the browser's own wake-ups are steps here.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  }, 120_000);
  beforeEach(async () => {
    server.dispatched = 0;
    server.cut = undefined;
    await env.clearFirestore();
    await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
    await admin.doc(dayPath).set(baseRecord());
    localStorage.clear();
    tab = await openTab();
    // Isolated fake IndexedDB only; never operate on a browser's real outbox.
    await tab.hospitalDB.dailyRecords.clear();
    await tab.hospitalDB.syncQueue.clear();
    tab.setFirestoreEnabled(true);
    await asP1(() => tab.reconcileAuthorizedSessionOwner(OWNER));
    await tab.hospitalDB.dailyRecords.put(baseRecord());
  });
  afterEach(() => {
    tab.hospitalDB.close();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await env?.cleanup();
    await admin?.terminate();
    if (app) await deleteApp(app);
  });

  it.each([
    ['diagnosis', 'saved without network'],
    ['diagnosis', 'being sent'],
    ['discharge', 'saved without network'],
    ['discharge', 'being sent'],
  ] as const)(
    'publishes once a %s that was %s when the tab closed',
    async (change, moment) => {
      // P1 makes the change without network: kept on this computer, nothing says «guardado».
      tab.setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
      const shown = (await tab.hospitalDB.dailyRecords.get(date)) as DailyRecord;
      const saved = await asP1(() =>
        tab.updatePartialDetailed(date, changes[change](shown), {
          authoringSession: tab.captureAuthoringSession(),
          baseRecord: shown,
        })
      );
      expect(saved).toMatchObject({ savedHere: true, state: 'local', cause: 'stored' });
      const [queued] = await tab.hospitalDB.syncQueue.toArray();
      expect(queued).toMatchObject({ ownerKey: OWNER, status: 'PENDING' });

      if (moment === 'being sent') {
        // The network comes back and the queue starts sending; the tab closes on the way.
        tab.setFirestoreEnabled(true);
        let reached!: () => void;
        const sending = new Promise<void>(resolve => (reached = resolve));
        server.cut = reached;
        // Past the short hold before a queued write's first attempt.
        const now = Date.now;
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + 60_000);
        void asP1(() => tab.processSyncQueue());
        await sending;
        clock.mockRestore();
        expect(await tab.hospitalDB.syncQueue.toArray()).toMatchObject([
          { id: queued.id, status: 'PROCESSING' },
        ]);
      }
      tab.hospitalDB.close();

      // The person opens the app again on this computer and signs in.
      tab = await openTab();
      await asP1(() => tab.reconcileAuthorizedSessionOwner(OWNER));
      // Before the network is back, the change is still shown and counted as pending.
      expect(shownChange(await tab.hospitalDB.dailyRecords.get(date), change)).toEqual(
        expectedShown(change)
      );
      const waiting = await asP1(() => tab.getSyncQueueTelemetry());
      expect(waiting.pending + waiting.failed + waiting.conflict).toBe(1);
      expect(shownChange(await readServer(), change)).not.toEqual(expectedShown(change));
      expect(server.dispatched).toBe(0);

      // The network is back: the queue sends it once, and nothing is left waiting.
      tab.setFirestoreEnabled(true);
      await runQueue();
      expect(server.dispatched).toBe(1);
      expect(shownChange(await readServer(), change)).toEqual(expectedShown(change));
      expect(await tab.hospitalDB.syncQueue.toArray()).toEqual([]);
      expect(shownChange(await tab.hospitalDB.dailyRecords.get(date), change)).toEqual(
        expectedShown(change)
      );
      const settled = await asP1(() => tab.getSyncQueueTelemetry());
      expect(settled.pending + settled.failed + settled.conflict).toBe(0);
    },
    60_000
  );
});
