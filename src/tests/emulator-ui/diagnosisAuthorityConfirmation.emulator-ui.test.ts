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
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import type { UpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  presentSyncOutcomeFeedback,
  resolvePatchOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getSyncQueueTelemetry, processSyncQueue } from '@/services/storage/sync';
import { reconcileAuthorizedSessionOwner } from '@/services/storage/sessionScopedStorageService';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';

/**
 * A diagnosis typed in the census cell, saved under the production configuration (the schema-v2
 * policy with enforced clinical batches, VITE_DAILY_RECORD_AUTHORITY_MODE left undefined): with
 * a normal confirmation, and when the server saved it but its answer never came back (SAVE-01,
 * SAVE-03). Runs the shipped census reducer, repository write, sync queue, callable client and
 * transport (with its receipt read of the server copy), the shipped authority handler in
 * `functions/lib` with the real admin transaction, and the real rules on the Firestore emulator.
 * Not real: the callable's HTTPS hop (Cloud Functions runtime, ID-token check, region), replaced
 * by a direct call of the handler; the role lookup, fixed to `nurse_hospital`; and the network
 * failures, injected at that hop and at the receipt read.
 */

// One SDK per person, bound to the async chain that writes, as in queueAcrossTabRestart.
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

/**
 * The HTTPS hop of `httpsCallable`. The handler runs and commits; `cut` then drops the answer, as
 * a connection lost on the way back does, and leaves the next `down` network calls (callable
 * sends and server reads) failing: none, only the receipt read that follows, or every one until
 * the test brings the network back.
 */
const network = vi.hoisted(() => ({
  dispatched: 0,
  cut: undefined as undefined | { down: number },
  down: 0,
  api: undefined as
    | undefined
    | Record<string, { run: (payload: unknown, context: unknown) => Promise<unknown> }>,
}));
/** Whether this network call fails because the connection is still down. */
const isDown = () => network.down > 0 && network.down-- > 0;
vi.mock('@/services/firebase-runtime/functionsRuntime', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/firebase-runtime/functionsRuntime')>()),
  defaultFunctionsRuntime: {
    ready: Promise.resolve(),
    getFunctions: async () => ({}),
    getRegionalFunctions: async () => ({}),
  },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    if (isDown())
      throw Object.assign(new Error('Synthetic network cut'), { code: 'functions/unavailable' });
    network.dispatched++;
    const uid = scope.getStore()?.uid;
    let data: unknown;
    try {
      data = await network.api?.[name].run(payload, {
        auth: { uid, token: { email: `${uid}@example.invalid` } },
      });
    } catch (error) {
      // What the Functions SDK raises for an HttpsError: the code under the `functions/` prefix.
      const { code, message, details } = error as {
        code?: string;
        message: string;
        details?: unknown;
      };
      throw Object.assign(new Error(message), { code: `functions/${code}`, details });
    }
    if (network.cut) {
      network.down = network.cut.down;
      network.cut = undefined;
      throw Object.assign(new Error('Synthetic lost answer'), {
        code: 'functions/deadline-exceeded',
      });
    }
    return { data };
  },
}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocFromServer: async (...args: Parameters<typeof actual.getDocFromServer>) => {
      if (isDown())
        throw Object.assign(new Error('Synthetic network cut'), { code: 'unavailable' });
      return actual.getDocFromServer(...args);
    },
  };
});

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-diagnosis-authority-confirmation';
const OWNER = 'user:synthetic-P1';
const DIAGNOSIS = 'NEUMONIA ADQUIRIDA EN LA COMUNIDAD';

const baseRecord = (): DailyRecord =>
  ({
    ...DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-01-01T00:00:00.000Z',
      dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
      activeExtraBeds: [],
      beds: {
        ...DataFactory.createMockDailyRecord(date).beds,
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'ANA SINTETICA',
          rut: '12.345.678-5',
          admissionDate: date,
          clinicalEpisodeId: 'synthetic-episode-R1',
          pathology: 'DIAGNOSTICO BASE',
          age: '40',
        }),
      },
    }),
    meta: { revision: 1 },
  }) as DailyRecord;

/** The notice the census shows for a patch result, as `useDailyRecordSyncQuery` presents it. */
const shownNotice = (result: UpdatePartialDailyRecordResult) => {
  const shown: string[] = [];
  presentSyncOutcomeFeedback(resolvePatchOutcomeFeedback(result), 'Actualización', {
    success: () => shown.push('success'),
    warning: () => shown.push('warning'),
    error: () => shown.push('error'),
  });
  return shown;
};

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)(
  'a census diagnosis saved through the production authority',
  () => {
    let env: RulesTestEnvironment;
    let app: App;
    let admin: Firestore;
    let computer: { db: unknown; uid: string; role: string };
    const asP1 = <T>(action: () => T): T => scope.run(computer, action);
    const readServer = async () => {
      const data = (await admin.doc(dayPath).get()).data();
      if (!data) throw new Error('Synthetic census missing');
      const stamp = data.lastUpdated;
      return docToRecord(
        { ...data, lastUpdated: stamp instanceof Timestamp ? stamp.toDate().toISOString() : stamp },
        date
      );
    };
    const historyCopies = async () => (await admin.collection(`${dayPath}/history`).get()).size;
    /** What the census does when the person types in the R1 diagnosis cell. */
    const typeDiagnosis = async () => {
      const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      const patch = bedManagementReducer(shown, {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value: DIAGNOSIS,
      });
      if (!patch) throw new Error('The census produced no patch');
      return asP1(() =>
        updatePartialDetailed(date, patch, {
          authoringSession: captureAuthoringSession(),
          baseRecord: shown,
        })
      );
    };
    const waiting = async () => {
      const telemetry = await asP1(() => getSyncQueueTelemetry());
      return telemetry.pending + telemetry.failed + telemetry.conflict;
    };
    /** The queue over the next half hour, past any retry wait. */
    const runQueue = async () => {
      const now = Date.now;
      for (let round = 1; round <= 3; round++) {
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + round * 10 * 60_000);
        try {
          await asP1(() => processSyncQueue());
        } finally {
          clock.mockRestore();
        }
      }
    };
    /** Everything settled: one saved version on the server, the cell, and nothing waiting. */
    const expectSavedOnce = async () => {
      expect((await readServer()).beds.R1.pathology).toBe(DIAGNOSIS);
      // One commit on top of the base revision, with one history copy: neither written twice
      // nor rolled back.
      expect((await admin.doc(dayPath).get()).data()?.meta).toMatchObject({ revision: 2 });
      expect(await historyCopies()).toBe(1);
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(DIAGNOSIS);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expect(await waiting()).toBe(0);
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
      app = initializeApp({ projectId }, 'diagnosis-authority-confirmation');
      admin = getFirestore(app);
      admin.settings({ ignoreUndefinedProperties: true });
      network.api = createDailyRecordWriteAuthorityFunctions({
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
    }, 120_000);
    beforeEach(async () => {
      // What production runs since 2026-11-07: the schema-v2 policy with enforced clinical batches.
      vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', '');
      vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', '');
      // The queue runs only when the test says so: the browser's own wake-ups are steps here.
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      Object.assign(network, { dispatched: 0, cut: undefined, down: 0 });
      await env.clearFirestore();
      await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2,
        mode: 'preview',
        revision: 7,
        clinicalBatchMode: 'enforced',
      });
      await admin.doc(dayPath).set(baseRecord());
      // Isolated fake IndexedDB only; never operate on a browser's real outbox.
      await hospitalDB.dailyRecords.clear();
      await hospitalDB.syncQueue.clear();
      localStorage.clear();
      setFirestoreEnabled(true);
      await asP1(() => reconcileAuthorizedSessionOwner(OWNER));
      await hospitalDB.dailyRecords.put(baseRecord());
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      setFirestoreEnabled(true);
    });
    afterAll(async () => {
      await env?.cleanup();
      await admin?.terminate();
      if (app) await deleteApp(app);
    });

    it('saves the diagnosis with one send and tells the person it is saved', async () => {
      const result = await typeDiagnosis();
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: true });
      expect(shownNotice(result)).toEqual(['success']);
      expect(network.dispatched).toBe(1);
      await expectSavedOnce();
    });

    it('confirms a diagnosis the server saved when its answer was lost, without a second send', async () => {
      network.cut = { down: 0 };
      const result = await typeDiagnosis();
      // The receipt read finds this exact change on the server: it is saved, not retried.
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: true });
      expect(shownNotice(result)).toEqual(['success']);
      await runQueue();
      expect(network.dispatched).toBe(1);
      await expectSavedOnce();
    });

    it('the server recognises the resend of a diagnosis whose answer and receipt were lost', async () => {
      // Only the receipt read fails; a second later the send is repeated and reaches the server.
      network.cut = { down: 1 };
      const result = await typeDiagnosis();
      expect(network.dispatched).toBe(2);
      // The server finds this exact change already stored: it answers without writing it again.
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: true });
      expect(shownNotice(result)).toEqual(['success']);
      await runQueue();
      expect(network.dispatched).toBe(2);
      await expectSavedOnce();
    });

    it('a diagnosis whose answer and receipt were both lost is recognised on retry, not written twice', async () => {
      // The connection stays down after the cut: the receipt read cannot reach the server either.
      network.cut = { down: Infinity };
      const result = await typeDiagnosis();
      // Saved on this computer and waiting; the person still sees the diagnosis, not «guardado».
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: false });
      expect(shownNotice(result)).not.toContain('success');
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe(DIAGNOSIS);
      expect(await waiting()).toBe(1);
      // The server already has it: the lost answer was the only failure.
      expect((await readServer()).beds.R1.pathology).toBe(DIAGNOSIS);
      expect(network.dispatched).toBe(1);

      // The network is back: the queue reads the server copy, finds this exact change already
      // stored and ends the task without sending it again.
      network.down = 0;
      await runQueue();
      expect(network.dispatched).toBe(1);
      await expectSavedOnce();
    });
  }
);
