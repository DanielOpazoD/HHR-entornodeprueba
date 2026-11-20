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
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  presentSyncOutcomeFeedback,
  resolvePatchOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getSyncQueueTelemetry } from '@/services/storage/sync';
import { reconcileAuthorizedSessionOwner } from '@/services/storage/sessionScopedStorageService';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
/**
 * A diagnosis typed in the census cell whose answer was lost, resent after another computer saved
 * (W20-C3 and its review): the server takes the resend as already applied only when the same
 * account and computer wrote it and nothing wrote that bed since. Runs the shipped census reducer,
 * repository write, retry loop, queue and notice, Dexie on fake IndexedDB, and the shipped
 * authority handlers on real Firestore transactions. Not real, as in
 * diagnosisAuthorityConfirmation: the callable's HTTPS hop, the role lookup and the injected
 * network failures. Only the collision case forces a mutation identifier.
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
  statuses: [] as (string | undefined)[],
  requestsLost: 0,
  answerLost: undefined as undefined | { downAfterCut: number },
  afterFirstReply: undefined as undefined | (() => Promise<void>),
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
    network.statuses.push((data as { authorityStatus?: string } | undefined)?.authorityStatus);
    if (network.afterFirstReply) {
      const follow = network.afterFirstReply;
      network.afterFirstReply = undefined;
      await follow();
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

// Identifiers are random (`createSyncMutationId`); this forces one to repeat another computer's.
const collision = vi.hoisted(() => ({ active: false }));
vi.mock('@/services/storage/sync/syncMutationIdentity', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/sync/syncMutationIdentity')>();
  return {
    ...actual,
    buildSyncMutationIdentity: () => {
      const identity = actual.buildSyncMutationIdentity();
      return collision.active ? { ...identity, mutationId: 'review-shared-id' } : identity;
    },
  };
});
const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-diagnosis-replay-authorship';
const OWNER = 'user:synthetic-P1';
const BASE = 'DIAGNOSTICO BASE';
const DIAGNOSIS = 'NEUMONIA ADQUIRIDA EN LA COMUNIDAD';
const CORRECTED = 'NEUMONIA POR ASPIRACION';
const OTHER = 'INSUFICIENCIA CARDIACA';

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
        R2: DataFactory.createMockPatient('R2', {
          patientName: 'BETO SINTETICO',
          rut: '11.111.111-1',
          admissionDate: date,
          clinicalEpisodeId: 'synthetic-episode-R2',
          pathology: BASE,
          age: '60',
        }),
      },
    }),
    meta: { revision: 1 },
  }) as DailyRecord;

/** The notice the census shows for a patch result, as `useDailyRecordSyncQuery` presents it. */
const shownNotice = (result: DailyRecordWriteResult) => {
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
    /**
     * What the census does when the person types in the R1 diagnosis cell; `screen` is the day the
     * census shows, by default this computer's stored copy.
     */
    const typeDiagnosis = async (value = DIAGNOSIS, screen?: DailyRecord) => {
      const shown = screen ?? ((await hospitalDB.dailyRecords.get(date)) as DailyRecord);
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
      app = initializeApp({ projectId }, 'diagnosis-replay-authorship');
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
      // The queue runs only when the test says so: the browser's own wake-ups are steps here.
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      Object.assign(network, {
        delivered: [],
        statuses: [],
        requestsLost: 0,
        answerLost: undefined,
        afterFirstReply: undefined,
        down: 0,
      });
      collision.active = false;
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

    let otherWrites = 0;
    /** Another computer saves `patch` through the same authority handler, with its own identity. */
    const otherComputerSaves = async (patch: Record<string, unknown>, id?: string) => {
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
            mutationId: id ?? `synthetic-P2-mutation-${++otherWrites}`,
            clientId: 'synthetic-P2-client',
            tabId: 'synthetic-P2-tab',
            changedPaths: Object.keys(patch),
            baseRevision: stored.meta?.revision,
          },
        },
        { auth: { uid: 'synthetic-P2', token: { email: 'synthetic-P2@example.invalid' } } }
      );
    };
    it('confirms a diagnosis whose answer was lost after another computer saved another bed', async () => {
      network.answerLost = { downAfterCut: 0 };
      network.afterFirstReply = () => otherComputerSaves({ 'beds.R2.pathology': OTHER });

      const result = await typeDiagnosis(DIAGNOSIS);

      expect(result.state).toBe('confirmed');
      expect(shownNotice(result)).toEqual(['success']);
      expect(await serverDiagnosis()).toBe(DIAGNOSIS);
      expect(await cellDiagnosis()).toBe(DIAGNOSIS);
      expect((await readServer()).beds.R2.pathology).toBe(OTHER);
      expect(await waiting()).toBe(0);
      // Transport: one commit, the retry answered as already applied, no second write.
      expect(network.statuses).toEqual(['ok', 'idempotent']);
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(3);
    });

    it('saves a correction whose identifier repeats another computer’s edit', async () => {
      collision.active = true;
      const patch = bedManagementReducer(await readServer(), {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value: DIAGNOSIS,
      });
      if (!patch) throw new Error('Missing diagnosis patch');
      await otherComputerSaves(patch, 'review-shared-id');
      await otherComputerSaves({ 'beds.R1.status': 'Grave' }, 'review-different-id');
      await hospitalDB.dailyRecords.put(await readServer());

      const result = await typeDiagnosis(CORRECTED);

      expect(result.state).toBe('confirmed');
      expect(await serverDiagnosis()).toBe(CORRECTED);
      expect(await cellDiagnosis()).toBe(CORRECTED);
      expect(await waiting()).toBe(0);
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(4);
    });

    it('saves a correction after the same account’s computer without an identifier used its edit identifier', async () => {
      collision.active = true;
      // A computer of the same account saved the first text without `clientId`.
      const day = await readServer();
      const patch = bedManagementReducer(day, {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value: DIAGNOSIS,
      });
      if (!patch) throw new Error('Missing diagnosis patch');
      await network.api!.patchDailyRecordWithClinicalAuthority.run(
        {
          date,
          patch,
          expectedLastUpdated: day.lastUpdated,
          mode: 'enforced',
          syncContract: {
            mutationId: 'review-shared-id',
            changedPaths: Object.keys(patch),
            baseRevision: 1,
          },
        },
        { auth: { uid: computer.uid, token: { email: `${computer.uid}@example.invalid` } } }
      );
      await otherComputerSaves({ 'beds.R2.pathology': OTHER }, 'independent-edit');
      await hospitalDB.dailyRecords.put(await readServer());

      const result = await typeDiagnosis(CORRECTED);

      expect(result.state).toBe('confirmed');
      expect(await serverDiagnosis()).toBe(CORRECTED);
      expect(await cellDiagnosis()).toBe(CORRECTED);
      expect(await waiting()).toBe(0);
      expect((await admin.doc(dayPath).get()).data()?.meta?.revision).toBe(4);
    });

    it('does not credit a resend of the former occupant’s diagnosis to the next episode', async () => {
      network.answerLost = { downAfterCut: 0 };
      network.afterFirstReply = async () => {
        // Another computer moves the patient to R2 and admits the next one in R1, same text.
        const current = await readServer();
        await expect(
          network.api!.saveDailyRecordWithClinicalAuthority.run(
            {
              date,
              record: {
                ...current,
                beds: {
                  ...current.beds,
                  R1: {
                    ...current.beds.R1,
                    patientName: 'NUEVO SINTETICO',
                    rut: '10.000.013-K',
                    clinicalEpisodeId: 'synthetic-next',
                    admissionTime: '12:00',
                  },
                  R2: { ...current.beds.R1, bedId: 'R2', pathology: OTHER },
                },
              },
              expectedLastUpdated: current.lastUpdated,
              mode: 'enforced',
              syncContract: {
                mutationId: 'other-admission',
                clientId: 'synthetic-P2-client',
                baseRevision: 2,
                changedPaths: ['beds.R1'],
              },
            },
            { auth: { uid: 'synthetic-P2', token: { email: 'synthetic-P2@example.invalid' } } }
          )
        ).resolves.toMatchObject({ revision: 3 });
      };

      const result = await typeDiagnosis(DIAGNOSIS);

      const server = await readServer();
      expect(server.beds.R1.clinicalEpisodeId).toBe('synthetic-next');
      expect(server.beds.R2).toMatchObject({
        clinicalEpisodeId: 'synthetic-episode-R1',
        pathology: OTHER,
      });
      // As main: held for review with a notice, the edit kept here for its own episode.
      expect(result.state).toBe('held');
      expect(shownNotice(result)).toEqual(['warning']);
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.clinicalEpisodeId).toBe(
        'synthetic-episode-R1'
      );
      expect(await waiting()).toBe(1);
      expect(network.statuses).not.toContain('idempotent');
    });
  }
);
