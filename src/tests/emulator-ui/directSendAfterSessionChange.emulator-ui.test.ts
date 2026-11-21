/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as fence from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
import {
  buildAtomicPatientMovementPatch,
  resolveAddDischargeMovement,
} from '@/application/census/public';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants/beds';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  resolvePatchOutcomeFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

/**
 * A census edit that already entered this computer's queue is on its way to the server when its
 * author's session ends (Cerrar sesión, or 1 h without use) and another person signs in on the
 * same computer. The direct send that follows the local write checks the session before each wait
 * and inside its transaction, as the queue's resend does, so the edit stays in its author's queue
 * instead of reaching the server inside the next person's session (W12-SC2, rule «nada se publica
 * a nombre de una sesión que ya no es la vigente»). The held step stands for a slow or returning
 * network: the read before a field edit or before its history copy, the transaction of a full-day
 * save, or the permission refresh after the rules refuse a bed edit. Everything else is the
 * shipped code against the Firestore emulator.
 */

// One SDK per person, bound to the async chain that writes, as in syncQueueModel.
const { scope } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return { scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string }>() };
});
vi.mock('@/firebaseConfig', () => ({
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

// The armed step answers only when the test says so (a slow network): a read of one document
// (after `skip` earlier reads of it), the next transaction, or the next permission refresh.
type HeldStep = { read: string; skip?: number } | 'transaction' | 'role refresh';
const slowStep = vi.hoisted(() => {
  const state = {
    next: undefined as
      | undefined
      | { step: HeldStep; reached: () => void; released: Promise<void>; seen: number },
    hold: async (matches: (step: HeldStep) => boolean) => {
      const held = state.next;
      if (!held || !matches(held.step)) return;
      if (typeof held.step === 'object' && held.seen++ < (held.step.skip ?? 0)) return;
      state.next = undefined;
      held.reached();
      await held.released;
    },
  };
  return state;
});
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDoc: async (...args: Parameters<typeof actual.getDoc>) => {
      await slowStep.hold(step => typeof step === 'object' && step.read === args[0].path);
      return actual.getDoc(...args);
    },
    runTransaction: async (...args: Parameters<typeof actual.runTransaction>) => {
      await slowStep.hold(step => step === 'transaction');
      return actual.runTransaction(...args);
    },
  };
});
// The permission refresh that follows a refused write waits, then fails (a token race).
vi.mock('@/services/storage/firestore/firestoreRecordWriteUtilities', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/services/storage/firestore/firestoreRecordWriteUtilities')
  >()),
  tryRefreshCurrentUserRoleClaim: async () => {
    await slowStep.hold(step => step === 'role refresh');
    return false;
  },
}));

// Only the callable's network hop is replaced: the shipped client and its session checks run,
// then the shipped authority handler commits with the real admin transaction.
const server = vi.hoisted(() => ({
  dispatched: 0,
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
const policyPath = 'hospitals/hanga_roa/settings/rayenImportPolicy';
const projectId = 'demo-hhr-direct-send-session';
const ownerOf = (person: 'P1' | 'P2') => `user:synthetic-${person}`;
const note = (record: Partial<DailyRecord>) => record.handoffNovedadesNightShift;
const diagnosis = (record: Partial<DailyRecord>) => record.beds?.R1?.pathology;
const discharged = (record: Partial<DailyRecord>) =>
  (record.discharges ?? []).map(item => item.patientName).join(', ');
// History copies written after the session changed.
const countHistory = async () => (await admin.collection(`${dayPath}/history`).get()).size;

let env: RulesTestEnvironment;
let app: App;
let admin: Firestore;
let computer: { db: unknown };
const as = <T>(person: 'P1' | 'P2', action: () => T): T =>
  scope.run({ db: computer.db, uid: `synthetic-${person}`, role: 'nurse_hospital' }, action);
const readServer = async (): Promise<DailyRecord> => {
  const data = (await admin.doc(dayPath).get()).data();
  if (!data) throw new Error('Synthetic census missing');
  const stamp = data.lastUpdated;
  return docToRecord(
    { ...data, lastUpdated: stamp instanceof Timestamp ? stamp.toDate().toISOString() : stamp },
    date
  );
};

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('a census edit on its way when the session changes', () => {
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
    app = initializeApp({ projectId }, 'direct-send-session');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    server.api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin,
      Timestamp,
      resolveRoleForEmail: async () => scope.getStore()?.role ?? 'nurse_hospital',
    });
    computer = {
      db: env
        .authenticatedContext('synthetic-P1', {
          email: 'synthetic-P1@example.invalid',
          role: 'nurse_hospital',
        })
        .firestore(),
    };
    setFirestoreEnabled(true);
    // The queue runs only when the test says so.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await env?.cleanup();
    await admin?.terminate();
    if (app) await deleteApp(app);
  });

  const saveDay = (shown: DailyRecord) =>
    saveDetailed(
      { ...shown, handoffNovedadesNightShift: 'NOTA SINTETICA DE P1' },
      shown.lastUpdated,
      { authoringSession: captureAuthoringSession(), baseRecord: shown }
    ).then(result => ({
      state: result.state,
      feedback: resolveSaveOutcomeFeedback(result),
    }));
  const editField =
    (patch: DailyRecordPatch, extra: { historyPolicy?: 'snapshot' } = {}) =>
    (shown: DailyRecord) =>
      updatePartialDetailed(date, patch, {
        authoringSession: captureAuthoringSession(),
        baseRecord: shown,
        ...extra,
      }).then(result => ({
        state: result.state,
        feedback: resolvePatchOutcomeFeedback(result),
      }));
  const writeNote = editField({ handoffNovedadesNightShift: 'NOTA SINTETICA DE P1' });
  // «Dar de alta» as the census saves it: kept here and queued, then sent by the queue.
  const dischargeThroughQueue = async (shown: DailyRecord) => {
    const resolution = resolveAddDischargeMovement({
      record: shown,
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
    // The network is slow only once the queue sends: the census routes a movement to the queue.
    const slowOnceQueued = slowStep.next;
    slowStep.next = undefined;
    const result = await updatePartialDetailed(
      date,
      buildAtomicPatientMovementPatch({
        updatedRecord: resolution.value.updatedRecord,
        movementKey: 'discharges',
        sourceBedIds: ['R1'],
      }),
      { authoringSession: captureAuthoringSession(), baseRecord: shown }
    );
    expect(result).toMatchObject({ state: 'local', cause: 'queue_route' });
    slowStep.next = slowOnceQueued;
    // Past the short hold before a queued write's first attempt.
    const now = Date.now;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + 60_000);
    try {
      await processSyncQueue();
    } finally {
      clock.mockRestore();
    }
    return {
      state: result.state,
      feedback: resolvePatchOutcomeFeedback(result),
    };
  };
  const sends: Record<
    string,
    {
      fence: boolean;
      /** The routing reads miss the fence, as on a token race at startup. */
      staleRouting?: boolean;
      held: HeldStep;
      send: (
        shown: DailyRecord
      ) => Promise<{ state: DailyRecordWriteResult['state']; feedback: unknown }>;
      field?: (record: Partial<DailyRecord>) => string | undefined;
      base?: string;
      written?: string;
    }
  > = {
    // A field edit: the read of the day before its transaction waits for the network.
    'field edit': { fence: true, held: { read: dayPath }, send: writeNote },
    // The same edit, with the read of its history copy waiting for the network.
    'field edit and its history copy': {
      fence: true,
      held: { read: dayPath, skip: 1 },
      send: editField(
        { handoffNovedadesNightShift: 'NOTA SINTETICA DE P1' },
        { historyPolicy: 'snapshot' }
      ),
    },
    // A bed edit written directly: the rules refuse it, and the permission refresh that would let
    // it go on through the authority waits for the network.
    'bed edit refused while permissions refresh': {
      fence: true,
      staleRouting: true,
      held: 'role refresh',
      send: editField({ 'beds.R1.pathology': 'DIAGNOSTICO SINTETICO DE P1' }),
      field: diagnosis,
      base: 'DIAGNOSTICO BASE',
      written: 'DIAGNOSTICO SINTETICO DE P1',
    },
    // A full-day save with the server's write fence on, as in production: the routing read
    // before the authority call waits for the network.
    'full-day save through the authority': {
      fence: true,
      held: { read: policyPath },
      send: saveDay,
    },
    // A full-day save without the fence: its transaction waits for the network.
    'full-day save in a transaction': { fence: false, held: 'transaction', send: saveDay },
    // «Dar de alta» sent by the queue: the queue's read of the server's write policy, right
    // before the send, waits for the network.
    '«Dar de alta» sent by the queue': {
      fence: true,
      held: { read: policyPath },
      send: dischargeThroughQueue,
      field: discharged,
      base: '',
      written: 'John Doe',
    },
  };

  it.each(Object.keys(sends))(
    'does not publish a %s after its author’s session ended',
    async kind => {
      const { field = note, base = 'NOCHE BASE', written = 'NOTA SINTETICA DE P1' } = sends[kind];
      server.dispatched = 0;
      const routing = sends[kind].staleRouting
        ? [vi.spyOn(fence, 'isServerClinicalWriteFenceActive').mockResolvedValue(false)]
        : [];
      await env.clearFirestore();
      await hospitalDB.dailyRecords.clear();
      await hospitalDB.syncQueue.clear();
      localStorage.clear();
      if (sends[kind].fence)
        await admin.doc(policyPath).set({
          schemaVersion: 2,
          mode: 'preview',
          revision: 7,
          clinicalBatchMode: 'enforced',
        });
      const day = DataFactory.createMockDailyRecord(date, {
        lastUpdated: '2026-01-01T00:00:00.000Z',
        dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
        handoffNovedadesNightShift: 'NOCHE BASE',
        activeExtraBeds: [],
      });
      day.beds.R1 = DataFactory.createMockPatient('R1', {
        pathology: 'DIAGNOSTICO BASE',
        clinicalEpisodeId: 'ep_synthetic_R1',
      });
      await admin.doc(dayPath).set({ ...day, meta: { revision: 1 } });
      // P1 is signed in on this computer and has the day open.
      await as('P1', () => reconcileAuthorizedSessionOwner(ownerOf('P1')));
      await as('P1', () => syncWithFirestoreDetailed(date));
      const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;

      // P1 writes the night shift note; the server is slow to answer.
      let reached!: () => void;
      let release!: () => void;
      const sending = new Promise<void>(resolve => (reached = resolve));
      slowStep.next = {
        step: sends[kind].held,
        reached,
        released: new Promise<void>(resolve => (release = resolve)),
        seen: 0,
      };
      const edit = as('P1', () => sends[kind].send(shown));
      await sending;
      // The edit is already in P1's queue on this computer: the send follows the local write.
      const queued = await hospitalDB.syncQueue.toArray();
      expect(
        queued.some(
          task => task.ownerKey === ownerOf('P1') && field(task.payload as DailyRecord) === written
        )
      ).toBe(true);

      const historyBeforeChange = await countHistory();
      // P1 closes the session (the 1 h inactivity logout runs the same cleanup) and P2 signs in.
      await as('P1', () => clearSessionScopedClientState('manual'));
      await as('P2', () => reconcileAuthorizedSessionOwner(ownerOf('P2')));

      // The server answers.
      release();
      const result = await edit;
      routing.forEach(spy => spy.mockRestore());
      const history = (await countHistory()) - historyBeforeChange;
      const retained = (await hospitalDB.syncQueue.toArray()).map(task => ({
        owner: task.ownerKey,
        status: task.status,
        code: task.lastErrorCode,
        text: field(task.payload as DailyRecord),
      }));
      process.stdout.write(
        `SC2 ${kind} after session change ${JSON.stringify({
          state: result.state,
          server: field(await readServer()),
          dispatched: server.dispatched,
          history,
          retained,
        })}\n`
      );
      // Rule: nothing is published for a session that is no longer the current one. P1's text
      // stays in P1's queue («Sesión cerrada») for P1 to review and resend, and P2 sees nothing.
      expect(field(await readServer())).toBe(base);
      expect(server.dispatched).toBe(0);
      expect(history).toBe(0);
      expect(result.state).not.toBe('confirmed');
      expect(result.feedback).toBeNull();
      expect(retained).toEqual([
        {
          owner: ownerOf('P1'),
          status: 'FAILED',
          code: 'session_owner_logged_out',
          text: written,
        },
      ]);
    },
    60_000
  );
});
