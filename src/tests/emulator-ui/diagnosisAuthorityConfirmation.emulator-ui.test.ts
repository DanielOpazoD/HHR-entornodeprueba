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
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
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
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  buildAddDischargeInput,
  buildAtomicPatientMovementPatch,
  buildDischargeAddCommandPayload,
  resolveAddDischargeMovement,
  resolveAtomicPatientMovementListKey,
} from '@/application/census/public';
import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { FIELD_CHANGED_ELSEWHERE_MESSAGE } from '@/services/storage/syncErrorCatalog';

/**
 * A diagnosis typed in the census cell, saved under the production configuration (the schema-v2
 * policy with enforced clinical batches, VITE_DAILY_RECORD_AUTHORITY_MODE left undefined): with
 * a normal confirmation, when the server saved it but its answer never came back, and when the
 * request never reached the server (SAVE-01, SAVE-03). Runs the shipped census reducer,
 * repository write, sync queue, callable client and transport (with its receipt read of the
 * server copy), the shipped authority handler in `functions/lib` with the real admin transaction,
 * the mutation-id generator, and the real rules on the Firestore emulator.
 * Not real: the callable's HTTPS hop (Cloud Functions runtime, ID-token check, App Check, region,
 * SDK timeout), replaced by a direct call of the handler's `run`; the role lookup, fixed to
 * `nurse_hospital`; the network failures, injected at that hop and at the client's Firestore
 * reads; and the waits between direct-send retries, set to zero (the retry loop itself is real).
 *
 * Each case states two kinds of expectation. Clinical: what the person sees (saved or pending,
 * the cell's value) and what stays on the server and in the queue (value, revision, history).
 * Transport, labelled as such: how many requests reached the server and what they carried. A
 * change that removes a round trip on purpose may need new transport numbers; the clinical
 * expectations must hold unchanged.
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
// The shipped retry loop (attempts, `shouldRetry`, `onRetry`) without its 1 + 2 + 4 s waits.
vi.mock('@/utils/networkUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/networkUtils')>();
  return {
    ...actual,
    withRetry: <T>(fn: () => Promise<T>, options: Parameters<typeof actual.withRetry>[1] = {}) =>
      actual.withRetry(fn, { ...options, initialDelay: 0 }),
  };
});

/**
 * The network between this computer and the server.
 * - `requestsLost`: the next callable requests time out before reaching the handler (the
 *   Functions endpoint is unreachable while Firestore reads still work).
 * - `answerLost`: the next request reaches the handler, which commits; its answer never comes
 *   back. The connection then stays down for `downAfterCut` more calls.
 * - `down`: callable requests and the client's Firestore reads fail with `unavailable`.
 * `delivered` records what reached the handler.
 */
const network = vi.hoisted(() => ({
  delivered: [] as { mutationId?: string; diagnosis?: unknown; change?: unknown }[],
  requestsLost: 0,
  answerLost: undefined as undefined | { downAfterCut: number },
  down: 0,
  api: undefined as
    | undefined
    | Record<string, { run: (payload: unknown, context: unknown) => Promise<unknown> }>,
}));
/** Whether this network call fails because the connection is still down. */
const isDown = () => network.down > 0 && network.down-- > 0;
const unavailable = () =>
  Object.assign(new Error('Synthetic network cut'), { code: 'unavailable' });
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
    if (network.requestsLost > 0) {
      network.requestsLost--;
      throw Object.assign(new Error('Synthetic lost request'), {
        code: 'functions/deadline-exceeded',
      });
    }
    // A patch from the direct send, or the whole day from the queue.
    const sent = payload as {
      syncContract?: { mutationId?: string };
      patch?: Record<string, unknown>;
      record?: { beds?: Record<string, { pathology?: unknown }> };
    };
    network.delivered.push(
      structuredClone({
        mutationId: sent.syncContract?.mutationId,
        diagnosis: sent.patch?.['beds.R1.pathology'] ?? sent.record?.beds?.R1?.pathology,
        change: sent.patch ?? sent.record,
      })
    );
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
    if (network.answerLost) {
      network.down = network.answerLost.downAfterCut;
      network.answerLost = undefined;
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
    // The receipt read after a lost answer.
    getDocFromServer: async (...args: Parameters<typeof actual.getDocFromServer>) => {
      if (isDown()) throw unavailable();
      return actual.getDocFromServer(...args);
    },
    // The queue's read of the server copy before it sends.
    getDoc: async (...args: Parameters<typeof actual.getDoc>) => {
      if (isDown()) throw unavailable();
      return actual.getDoc(...args);
    },
  };
});

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-diagnosis-authority-confirmation';
const OWNER = 'user:synthetic-P1';
const BASE = 'DIAGNOSTICO BASE';
const DIAGNOSIS = 'NEUMONIA ADQUIRIDA EN LA COMUNIDAD';
const CORRECTED = 'NEUMONIA POR ASPIRACION';
const THIRD = 'NEUMONIA POR ASPIRACION, EN TRATAMIENTO';
const OTHER = 'INSUFICIENCIA CARDIACA';
const night = 'handoffNovedadesNightShift';

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
          pathology: BASE,
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
    const serverDiagnosis = async () => (await readServer()).beds.R1.pathology;
    const cellDiagnosis = async () => (await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology;
    /** What the census does when the person types in the R1 diagnosis cell. */
    const typeDiagnosis = async (value = DIAGNOSIS) => {
      const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      const patch = bedManagementReducer(shown, {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value,
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
    /** The browser's clock moves on across the test, so every retry wait the queue set is past. */
    let clockShift = 0;
    /** The queue over the next half hour. */
    const runQueue = async () => {
      const now = Date.now;
      for (let round = 1; round <= 3; round++) {
        clockShift += 10 * 60_000;
        const shift = clockShift;
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => now() + shift);
        try {
          await asP1(() => processSyncQueue());
        } finally {
          clock.mockRestore();
        }
      }
    };
    /** Clinical: the person is told «guardado». */
    const expectShownSaved = (result: UpdatePartialDailyRecordResult) => {
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: true });
      expect(shownNotice(result)).toEqual(['success']);
    };
    /** Clinical: kept on this computer and waiting, never «guardado». */
    const expectShownPending = async (result: UpdatePartialDailyRecordResult, cell: string) => {
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: false });
      expect(result.queuedForRetry).toBe(true);
      expect(shownNotice(result)).not.toContain('success');
      expect(await cellDiagnosis()).toBe(cell);
      expect(await waiting()).toBeGreaterThan(0);
    };
    /**
     * Clinical, once everything settled: the server holds `diagnosis` at `revision` (one commit
     * per edit on top of the base revision 1: neither written twice nor rolled back), its history
     * holds each earlier version in order, the cell shows it and nothing waits in the queue.
     */
    const expectClinicalOutcome = async ({
      diagnosis = DIAGNOSIS,
      history = [BASE],
    }: { diagnosis?: string; history?: string[] } = {}) => {
      expect(await serverDiagnosis()).toBe(diagnosis);
      expect((await admin.doc(dayPath).get()).data()?.meta).toMatchObject({
        revision: history.length + 1,
      });
      const copies = await admin.collection(`${dayPath}/history`).orderBy('__name__').get();
      expect(copies.docs.map(copy => copy.data().beds?.R1?.pathology)).toEqual(history);
      expect(copies.docs.map(copy => copy.data().meta?.revision)).toEqual(
        history.map((_, index) => index + 1)
      );
      expect(await cellDiagnosis()).toBe(diagnosis);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expect(await waiting()).toBe(0);
    };
    /** Transport: the requests that reached the authority handler, and the diagnosis each carried. */
    const expectDelivered = (diagnoses: string[]) =>
      expect(
        network.delivered.map(request => request.diagnosis),
        'transport: requests that reached the server'
      ).toEqual(diagnoses);

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
      Object.assign(network, { delivered: [], requestsLost: 0, answerLost: undefined, down: 0 });
      clockShift = 0;
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

    it('saves the diagnosis and tells the person it is saved', async () => {
      const result = await typeDiagnosis();
      expectShownSaved(result);
      await expectClinicalOutcome();
      expectDelivered([DIAGNOSIS]);
    });

    it('confirms a diagnosis the server saved when its answer was lost', async () => {
      network.answerLost = { downAfterCut: 0 };
      const result = await typeDiagnosis();
      // The receipt read finds this exact change on the server.
      expectShownSaved(result);
      await runQueue();
      await expectClinicalOutcome();
      // Transport: the receipt confirms it, so nothing is sent again.
      expectDelivered([DIAGNOSIS]);
    });

    it('keeps a diagnosis whose request never reached the server pending until it arrives', async () => {
      // Every request times out on the way while Firestore still answers reads: the receipt read
      // finds the base version, not this change.
      network.requestsLost = Infinity;
      const result = await typeDiagnosis();
      await expectShownPending(result, DIAGNOSIS);
      expect(await serverDiagnosis()).toBe(BASE);
      // The queue's own attempts are lost too: the change keeps waiting, never dropped.
      await runQueue();
      expect(await serverDiagnosis()).toBe(BASE);
      expect(await cellDiagnosis()).toBe(DIAGNOSIS);
      expect(await waiting()).toBeGreaterThan(0);
      expectDelivered([]);

      // The endpoint answers again: the queue publishes the diagnosis once.
      network.requestsLost = 0;
      await runQueue();
      await expectClinicalOutcome();
      expectDelivered([DIAGNOSIS]);
    });

    it('the server recognises the resend of a diagnosis whose answer and receipt were lost', async () => {
      // Only the receipt read fails; the direct send then repeats the request, which arrives.
      network.answerLost = { downAfterCut: 1 };
      const result = await typeDiagnosis();
      // The server finds this exact change already stored: it answers without writing it again.
      expectShownSaved(result);
      await runQueue();
      await expectClinicalOutcome();
      // Transport: the repeat reached the server, with the same change under the same identifier.
      expectDelivered([DIAGNOSIS, DIAGNOSIS]);
      const [first, repeat] = network.delivered;
      expect(repeat, 'transport: the repeat is the same change').toEqual(first);
      expect(first.mutationId).toEqual(expect.any(String));
    });

    it('a diagnosis whose answer and receipt were both lost is recognised later, not written twice', async () => {
      // The connection stays down after the cut: reads cannot reach the server either.
      network.answerLost = { downAfterCut: Infinity };
      const result = await typeDiagnosis();
      await expectShownPending(result, DIAGNOSIS);
      // The server already has it: the lost answer was the only failure.
      expect(await serverDiagnosis()).toBe(DIAGNOSIS);
      // While still offline the queue cannot read the server, and the change keeps waiting.
      await runQueue();
      expect(await waiting()).toBeGreaterThan(0);

      // The network is back: the queue finds this change on the server and ends the task.
      network.down = 0;
      await runQueue();
      await expectClinicalOutcome();
      // Transport: recognised from the server copy, so nothing is sent again.
      expectDelivered([DIAGNOSIS]);
    });

    it('saves a diagnosis and its correction typed one after the other, in order', async () => {
      expectShownSaved(await typeDiagnosis(DIAGNOSIS));
      expectShownSaved(await typeDiagnosis(CORRECTED));
      await expectClinicalOutcome({ diagnosis: CORRECTED, history: [BASE, DIAGNOSIS] });
      // Transport: two changes, each under its own identifier.
      expectDelivered([DIAGNOSIS, CORRECTED]);
      const [first, correction] = network.delivered;
      expect(correction.mutationId, 'transport: the correction is a new change').not.toBe(
        first.mutationId
      );
    });

    /**
     * The person types a diagnosis, its answer is lost, and they correct it while offline;
     * `meanwhile` runs between the first edit and the correction.
     */
    const correctWhileAnswerLost = async (meanwhile?: () => Promise<unknown>) => {
      network.answerLost = { downAfterCut: Infinity };
      await expectShownPending(await typeDiagnosis(DIAGNOSIS), DIAGNOSIS);
      expect(await serverDiagnosis()).toBe(DIAGNOSIS);
      await meanwhile?.();
      await expectShownPending(await typeDiagnosis(CORRECTED), CORRECTED);
      network.down = 0;
      await runQueue();
    };
    let otherWrites = 0;
    /** Another computer saves `patch` through the same authority handler, with its own identity. */
    const otherComputerSaves = async (patch: Record<string, unknown>) => {
      const stored = (await admin.doc(dayPath).get()).data()!;
      const stamp = stored.lastUpdated;
      await network.api!.patchDailyRecordWithClinicalAuthority.run(
        {
          date,
          patch,
          expectedLastUpdated:
            stamp instanceof Timestamp ? stamp.toDate().toISOString() : String(stamp),
          mode: 'enforced',
          syncContract: {
            mutationId: `synthetic-P2-mutation-${++otherWrites}`,
            clientId: 'synthetic-P2-client',
            tabId: 'synthetic-P2-tab',
            changedPaths: Object.keys(patch),
            baseRevision: stored.meta?.revision,
          },
        },
        { auth: { uid: 'synthetic-P2', token: { email: 'synthetic-P2@example.invalid' } } }
      );
    };
    /**
     * Clinical, for a real conflict: the server keeps `diagnosis` at `revision`, and the whole
     * task waits for review with both edits' identifiers and the correction, which the cell shows.
     */
    const expectCorrectionHeld = async (diagnosis: string, revision: number) => {
      expect(await serverDiagnosis()).toBe(diagnosis);
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(revision);
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(
        tasks.map(task => ({
          status: task.status,
          error: task.error,
          diagnosis: (task.payload as DailyRecord).beds.R1.pathology,
          paths: task.syncContract?.changedPaths,
          mutations: task.syncContract?.mutationIds?.length,
        }))
      ).toEqual([
        {
          status: 'CONFLICT',
          error: expect.stringContaining(FIELD_CHANGED_ELSEWHERE_MESSAGE),
          diagnosis: CORRECTED,
          paths: expect.arrayContaining(['beds.R1.pathology']),
          mutations: 2,
        },
      ]);
      expect(await cellDiagnosis()).toBe(CORRECTED);
      expect(await waiting()).toBe(1);
    };

    // Found 2026-11-17 (W14-T2), fixed in W14-ACK1: the correction joins the first edit's queued
    // task (compacted: `mutationIds` [first, correction], base value BASE). The server holds the
    // first edit under its own identifier, at the version it produced: the replay takes that
    // stored value as the correction's base, instead of a change from another computer.
    it('a second diagnosis typed while the first one’s answer is lost is saved after it', async () => {
      await correctWhileAnswerLost();
      // Both edits on the server in order: the first one, then the correction on top.
      await expectClinicalOutcome({ diagnosis: CORRECTED, history: [BASE, DIAGNOSIS] });
      // Transport: the correction travels as its own change, never as a repeat of the first.
      expectDelivered([DIAGNOSIS, CORRECTED]);
      const [first, correction] = network.delivered;
      expect(correction.mutationId, 'transport: the correction is a new change').not.toBe(
        first.mutationId
      );
    });

    it('never drops a diagnosis corrected while the first one’s answer is lost', async () => {
      await correctWhileAnswerLost();
      // Holds with the defect above and after its fix: the correction is on the server or still
      // kept in this computer's queue, and the cell shows it.
      expect(await cellDiagnosis()).toBe(CORRECTED);
      const kept = (await hospitalDB.syncQueue.toArray()).map(
        task => (task.payload as DailyRecord).beds?.R1?.pathology
      );
      expect([await serverDiagnosis(), ...kept]).toContain(CORRECTED);
    });

    it('holds the correction when another computer changed that diagnosis in between', async () => {
      await correctWhileAnswerLost(() => otherComputerSaves({ 'beds.R1.pathology': OTHER }));
      await expectCorrectionHeld(OTHER, 3);
      // Transport: the queue never sends the correction over the other computer's diagnosis.
      expectDelivered([DIAGNOSIS]);
    });

    it('holds the correction when another computer saved the same text as the first edit', async () => {
      // Equal text, but another computer's save: it is not this task's first edit.
      await correctWhileAnswerLost(() => otherComputerSaves({ 'beds.R1.pathology': DIAGNOSIS }));
      await expectCorrectionHeld(DIAGNOSIS, 3);
      expectDelivered([DIAGNOSIS]);
    });

    it('holds the correction when a later write kept the first edit’s identifier', async () => {
      // A write that leaves the day's meta as it was (a direct client write does) puts the same
      // text: the stored day is no longer the version the first edit produced.
      await correctWhileAnswerLost(() =>
        admin.doc(dayPath).update({ 'beds.R1.pathology': DIAGNOSIS, lastUpdated: Timestamp.now() })
      );
      await expectCorrectionHeld(DIAGNOSIS, 2);
      expectDelivered([DIAGNOSIS]);
    });

    // Found 2026-11-18 (review of W14-ACK1), fixed in W16-ABA1: another computer puts the original
    // diagnosis back while the first edit's answer is lost. The server then holds the base value
    // again, so the value alone looks untouched; the other computer's write naming that field after
    // this task's base makes it a change.
    /** The other computer's census, when its person types `value` in the R1 diagnosis cell. */
    const otherComputerTypesDiagnosis = async (value: string) => {
      const patch = bedManagementReducer(await readServer(), {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value,
      });
      if (!patch) throw new Error('The census produced no patch');
      await otherComputerSaves(patch);
      expect(await serverDiagnosis()).toBe(value);
    };
    /** A day whose diagnosis was already typed by hand, so a restore leaves every edited field at its base. */
    const seedManualDiagnosis = async (day = baseRecord()) => {
      day.beds.R1.diagnosisManualOverride = true;
      await admin.doc(dayPath).set(day);
      await hospitalDB.dailyRecords.put(day);
    };

    it('holds the correction when another computer restored the original diagnosis', async () => {
      await seedManualDiagnosis();
      await correctWhileAnswerLost(() => otherComputerTypesDiagnosis(BASE));
      await expectCorrectionHeld(BASE, 3);
      // Transport: the queue never sends the correction over the restored diagnosis.
      expectDelivered([DIAGNOSIS]);
    });

    it('holds the correction when another computer restored the diagnosis of a day saved without a revision', async () => {
      // An older day: the server numbers its first authority write 1.
      const day = baseRecord();
      delete (day as { meta?: unknown }).meta;
      await seedManualDiagnosis(day);
      await correctWhileAnswerLost(() => otherComputerTypesDiagnosis(BASE));
      await expectCorrectionHeld(BASE, 2);
      expectDelivered([DIAGNOSIS]);
    });

    // Found by the review of W16-ABA1: a field first edited after this computer read another
    // computer's write of it joins a task pending since an older revision. That write is the value
    // the person edited over, not a change after it.
    it('publishes a diagnosis corrected over another computer’s save this computer had read, with an older edit pending', async () => {
      await seedManualDiagnosis();
      network.requestsLost = Infinity;
      const shown = (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      const status = await asP1(() =>
        updatePartialDetailed(date, { 'beds.R1.status': 'Grave' } as DailyRecordPatch, {
          authoringSession: captureAuthoringSession(),
          baseRecord: shown,
        })
      );
      await expectShownPending(status, BASE);
      await otherComputerTypesDiagnosis(OTHER);
      // This computer reads the day again and shows the other computer's diagnosis.
      const read = await asP1(() => getForDateWithMeta(date));
      expect(read.record?.beds.R1.pathology).toBe(OTHER);
      expect(await cellDiagnosis()).toBe(OTHER);
      await expectShownPending(await typeDiagnosis(CORRECTED), CORRECTED);
      network.requestsLost = 0;
      await runQueue();
      expect((await readServer()).beds.R1).toMatchObject({ pathology: CORRECTED, status: 'Grave' });
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expect(await waiting()).toBe(0);
    });

    it('publishes a pending diagnosis after another computer changed another field of the bed', async () => {
      network.requestsLost = Infinity;
      await expectShownPending(await typeDiagnosis(DIAGNOSIS), DIAGNOSIS);
      await otherComputerSaves({ 'beds.R1.status': 'Grave' });
      network.requestsLost = 0;
      await runQueue();
      const stored = await readServer();
      expect(stored.beds.R1).toMatchObject({ pathology: DIAGNOSIS, status: 'Grave' });
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(3);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expectDelivered([DIAGNOSIS]);
    });

    it('publishes a pending diagnosis typed over another computer’s earlier save of it', async () => {
      // This computer already shows the other computer's diagnosis when its person edits it.
      await otherComputerSaves({ 'beds.R1.pathology': OTHER });
      await hospitalDB.dailyRecords.put(await readServer());
      network.requestsLost = Infinity;
      await expectShownPending(await typeDiagnosis(DIAGNOSIS), DIAGNOSIS);
      network.requestsLost = 0;
      await runQueue();
      expect(await serverDiagnosis()).toBe(DIAGNOSIS);
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(3);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expectDelivered([DIAGNOSIS]);
    });

    it('publishes a pending diagnosis after another computer rewrote the bed without changing it', async () => {
      network.requestsLost = Infinity;
      await expectShownPending(await typeDiagnosis(DIAGNOSIS), DIAGNOSIS);
      // A write naming the whole bed, stamped as the server stamps every write: it says nothing
      // about the diagnosis, which stays at its base.
      const stamp = Timestamp.now();
      await admin.doc(dayPath).update({
        'beds.R1': (await readServer()).beds.R1,
        lastUpdated: stamp,
        'meta.revision': 2,
        'meta.lastMutationId': 'synthetic-P2-bed',
        'meta.lastChangedPaths': ['beds.R1'],
        'meta.updatedAt': stamp,
      });
      network.requestsLost = 0;
      await runQueue();
      expect(await serverDiagnosis()).toBe(DIAGNOSIS);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      expectDelivered([DIAGNOSIS]);
    });

    it('sends the correction once when the first diagnosis never reached the server', async () => {
      network.requestsLost = Infinity;
      await expectShownPending(await typeDiagnosis(DIAGNOSIS), DIAGNOSIS);
      await expectShownPending(await typeDiagnosis(CORRECTED), CORRECTED);
      expect(await serverDiagnosis()).toBe(BASE);
      network.requestsLost = 0;
      await runQueue();
      await expectClinicalOutcome({ diagnosis: CORRECTED, history: [BASE] });
      expectDelivered([CORRECTED]);
    });

    it('saves three diagnoses in order when two of their answers were lost', async () => {
      network.answerLost = { downAfterCut: Infinity };
      await expectShownPending(await typeDiagnosis(DIAGNOSIS), DIAGNOSIS);
      await expectShownPending(await typeDiagnosis(CORRECTED), CORRECTED);
      // The connection comes back for the queue's send, and that answer is lost too.
      network.down = 0;
      network.answerLost = { downAfterCut: Infinity };
      await runQueue();
      expect(await serverDiagnosis()).toBe(CORRECTED);
      await expectShownPending(await typeDiagnosis(THIRD), THIRD);
      network.down = 0;
      await runQueue();
      await expectClinicalOutcome({ diagnosis: THIRD, history: [BASE, DIAGNOSIS, CORRECTED] });
      expectDelivered([DIAGNOSIS, CORRECTED, THIRD]);
      expect(
        new Set(network.delivered.map(request => request.mutationId)).size,
        'transport: three changes, each under its own identifier'
      ).toBe(3);
    });

    it('never writes the correction over another patient now in the bed', async () => {
      const BETO = {
        ...DataFactory.createMockPatient('R1', {
          patientName: 'BETO SINTETICO',
          rut: '11.111.111-1',
          admissionDate: date,
          clinicalEpisodeId: 'synthetic-episode-R1-next',
          // The same text as the first patient's base: only the episode tells them apart.
          pathology: BASE,
          age: '61',
        }),
      };
      await correctWhileAnswerLost(async () => {
        // Another computer's admission, stamped as the server stamps every write.
        const stamp = Timestamp.now();
        await admin.doc(dayPath).update({
          'beds.R1': BETO,
          lastUpdated: stamp,
          'meta.revision': 3,
          'meta.lastMutationId': 'synthetic-P2-admission',
          'meta.lastChangedPaths': ['beds.R1'],
          'meta.updatedAt': stamp,
        });
      });
      const stored = await readServer();
      expect(stored.beds.R1).toMatchObject({ rut: BETO.rut, pathology: BASE });
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(3);
      // The correction stays kept for the patient it was written for (ID-01).
      const kept = (await hospitalDB.syncQueue.toArray()).map(task => [
        task.status,
        (task.payload as DailyRecord).beds.R1.rut,
        (task.payload as DailyRecord).beds.R1.pathology,
      ]);
      expect(kept).toContainEqual(['CONFLICT', '12.345.678-5', CORRECTED]);
      expectDelivered([DIAGNOSIS]);
    });

    it('publishes the correction and a discharge, and holds a text another computer changed', async () => {
      // A second patient and the night handoff text on the day.
      const day = baseRecord();
      day.beds.R2 = DataFactory.createMockPatient('R2', {
        patientName: 'CARLA SINTETICA',
        rut: '10.000.013-K',
        admissionDate: date,
        clinicalEpisodeId: 'synthetic-episode-R2',
        pathology: 'FRACTURA DE CADERA',
        age: '80',
      });
      day[night] = 'NOCHE BASE';
      await admin.doc(dayPath).set(day);
      await hospitalDB.dailyRecords.put(day);
      // Another computer changes the night text before this computer's first edit (a direct write,
      // as the census saves day texts).
      await admin
        .doc(dayPath)
        .update({ [night]: 'NOCHE OTRO EQUIPO', lastUpdated: Timestamp.now() });
      const shownDay = async () => (await hospitalDB.dailyRecords.get(date)) as DailyRecord;
      const patchHere = async (patch: DailyRecordPatch) => {
        const shown = await shownDay();
        return asP1(() =>
          updatePartialDetailed(date, patch, {
            authoringSession: captureAuthoringSession(),
            baseRecord: shown,
          })
        );
      };
      await correctWhileAnswerLost(async () => {
        // «Dar de alta» for R2, as the census row builds it.
        const record = await shownDay();
        const resolution = resolveAddDischargeMovement(
          buildAddDischargeInput({
            record,
            bedId: 'R2',
            payload: buildDischargeAddCommandPayload({
              status: 'Vivo',
              dischargeType: 'Domicilio (Habitual)',
              time: '10:00',
              target: 'both',
            }),
            bedsCatalog: BEDS,
            createEmptyPatient,
          })
        );
        if (!resolution.ok) throw new Error('The census refused the discharge');
        await patchHere(
          buildAtomicPatientMovementPatch({
            updatedRecord: resolution.value.updatedRecord,
            movementKey: resolveAtomicPatientMovementListKey('discharge'),
            sourceBedIds: ['R2'],
          })
        );
        await patchHere({ [night]: 'NOCHE ESTE EQUIPO' } as DailyRecordPatch);
      });
      const stored = await readServer();
      expect(stored.beds.R1.pathology).toBe(CORRECTED);
      expect(stored.beds.R2).toMatchObject({ rut: '', patientName: '' });
      expect(stored.discharges.map(item => item.patientName)).toEqual(['CARLA SINTETICA']);
      expect(stored[night]).toBe('NOCHE OTRO EQUIPO');
      expect(
        (await hospitalDB.syncQueue.toArray()).map(task => [
          task.status,
          task.syncContract?.changedPaths,
          (task.payload as DailyRecord)[night],
          task.error,
        ])
      ).toEqual([
        [
          'CONFLICT',
          [night],
          'NOCHE ESTE EQUIPO',
          expect.stringContaining(FIELD_CHANGED_ELSEWHERE_MESSAGE),
        ],
      ]);
    });
  }
);
