/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import * as writes from '@/services/storage/firestore/firestoreRecordWrites';
import * as guards from '@/services/storage/firestore/firestoreWriteSupport';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { resolveRecordBaseRevision } from '@/services/storage/sync/syncTaskContractPolicy';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

// Bind SDK/auth per async writer; a mutable global DB would mix the two devices mid-write.
const { scope, queueControl, transport } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return {
    transport: { missing: false },
    queueControl: { online: false },
    scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string }>(),
  };
});
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    updateDoc: (...args: Parameters<typeof actual.updateDoc>) => {
      if (transport.missing) return Promise.reject({ code: 'not-found' });
      return actual.updateDoc(...args);
    },
  };
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

vi.unmock('@/services/repositories/dailyRecordPort');
vi.mock('@/services/storage/sync/browserSyncRuntime', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/sync/browserSyncRuntime')>();
  return {
    createBrowserSyncRuntime: () => ({
      ...actual.createBrowserSyncRuntime(),
      isOnline: () => queueControl.online,
    }),
  };
});

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const policyPath = 'hospitals/hanga_roa/settings/rayenImportPolicy';
// Own emulator project: other two-user rehearsals run in parallel on the same day document.
const projectId = 'demo-hhr-e8e';
const baseRecord = () => ({
  ...DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-01-01T00:00:00.000Z',
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    nursesDayShift: ['ENFERMERA BASE', ''],
    handoffNovedadesDayShift: 'NOVEDAD BASE',
    activeExtraBeds: [],
    // Every canonical bed is stored, as on a real day; only R1 and R2 are occupied.
    beds: {
      ...DataFactory.createMockDailyRecord(date).beds,
      ...Object.fromEntries(
        ['R1', 'R2'].map((bedId, index) => [
          bedId,
          DataFactory.createMockPatient(bedId, {
            patientName: `PACIENTE SINTETICO ${index + 1}`,
            rut: `${index + 1}1111111-1`,
            admissionDate: date,
            clinicalEpisodeId: `synthetic-episode-${bedId}`,
            pathology: 'BASE',
            age: '40',
          }),
        ])
      ),
    },
  }),
  meta: { revision: 1 },
});

// No real Firebase config, credentials, Functions endpoint or patient data are loaded.
const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('daily record writes under the production authority', () => {
  let env: RulesTestEnvironment;
  let app: App;
  let admin: Firestore;
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  let clients: Record<'A' | 'B', { db: unknown; uid: string; role: string }>;
  const calls = { patch: 0, save: 0, transaction: 0, direct: 0 };
  const actor = <T>(id: 'A' | 'B', action: () => T): T => scope.run(clients[id], action);
  const patch = (id: 'A' | 'B', data: DailyRecordPatch, base = baseRecord()) =>
    actor(id, () =>
      writes.updateRecordPartial(date, data, base.lastUpdated, {
        historyPolicy: 'skip',
        syncContract: {
          mutationId: `synthetic-${id}-${Object.keys(data).join('-')}`,
          baseRevision: resolveRecordBaseRevision(base),
          changedPaths: Object.keys(data),
        },
      })
    );
  const context = () => ({
    auth: {
      uid: scope.getStore()?.uid,
      token: { email: `${scope.getStore()?.uid}@example.invalid` },
    },
  });
  const bridge = () => {
    // Only the callable transport is replaced: run the shipped handler and real admin transaction.
    vi.spyOn(authority, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        calls.patch++;
        try {
          return await api.patchDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
    vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        calls.save++;
        try {
          return await api.saveDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
    const atomic = guards.updateRecordPartiallyAtomically;
    vi.spyOn(guards, 'updateRecordPartiallyAtomically').mockImplementation(async (...args) => {
      calls.transaction++;
      return atomic(...args);
    });
  };
  const configure = async () => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', '');
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', '');
    await admin.doc(policyPath).set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
  };
  const countDirectWrites = () => {
    const check = guards.assertFirestoreConcurrency;
    vi.spyOn(guards, 'assertFirestoreConcurrency').mockImplementation(async (...args) => {
      calls.direct++;
      return check(...args);
    });
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
    app = initializeApp({ projectId }, 'production-authority');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin,
      Timestamp,
      resolveRoleForEmail: async () => scope.getStore()?.role ?? 'nurse_hospital',
    });
    const nurse = (uid: string, email: string) => ({
      uid,
      role: 'nurse_hospital',
      db: env.authenticatedContext(uid, { email, role: 'nurse_hospital' }).firestore(),
    });
    clients = {
      A: nurse('synthetic-A', 'hospitalizados@hospitalhangaroa.cl'),
      B: nurse('synthetic-B', 'doctor@example.com'),
    };
  });
  beforeEach(async () => {
    queueControl.online = false;
    transport.missing = false;
    await env.clearFirestore();
    // Isolated fake IndexedDB only; never operate on a browser's real outbox.
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    // The observed browser is device B, admitted for its signed-in nurse.
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
    setFirestoreEnabled(true);

    await admin.doc(dayPath).get();
    calls.patch = calls.save = calls.transaction = calls.direct = 0;
    bridge();
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

  for (const config of ['production', 'absent'] as const) {
    for (const role of ['nurse_hospital', 'admin', 'doctor_urgency']) {
      for (const [label, data] of [
        ['bed', { 'beds.R1.pathology': 'EDITADO' }],
        ['day', { handoffNovedadesDayShift: 'EDITADO' }],
        ['staff', { nursesDayShift: ['ENFERMERA NUEVA', ''] }],
      ] as const) {
        it(`${config} ${role} ${label}`, async () => {
          if (config === 'production') await configure();
          clients.B = {
            uid: 'synthetic-B',
            role,
            db: env
              .authenticatedContext('synthetic-B', { email: 'synthetic@example.invalid', role })
              .firestore(),
          };
          countDirectWrites();
          await hospitalDB.dailyRecords.put(baseRecord());
          let error: unknown;
          try {
            await patch('B', data as DailyRecordPatch);
          } catch (e) {
            error = e;
          }
          const remote = (await admin.doc(dayPath).get()).data();
          const directCalls = { ...calls };
          expect(error).toBeDefined();
          expect(directCalls.save).toBe(0);
          expect(remote).toBeUndefined();
        });

        it(`app ${config} ${role} ${label}`, async () => {
          if (config === 'production') await configure();
          clients.B = {
            uid: 'synthetic-B',
            role,
            db: env
              .authenticatedContext('synthetic-B', { email: 'synthetic@example.invalid', role })
              .firestore(),
          };
          await hospitalDB.dailyRecords.put(baseRecord());
          const result = await actor('B', () =>
            updatePartialDetailed(date, data as DailyRecordPatch, {
              authoringSession: captureAuthoringSession(),
              baseRecord: baseRecord(),
            })
          );
          const queue = await hospitalDB.syncQueue.toArray();
          const before = (await admin.doc(dayPath).get()).data();
          queueControl.online = true;
          await actor('B', () => processSyncQueue());
          const after = (await admin.doc(dayPath).get()).data();
          expect(result.updatedRemotely).toBe(false);
          expect(before).toBeUndefined();
          expect(queue).toMatchObject([
            {
              status: 'PENDING',
              payload: { date, beds: { R2: { clinicalEpisodeId: 'synthetic-episode-R2' } } },
            },
          ]);
          if (role === 'doctor_urgency') {
            expect(after).toBeUndefined();
            expect(await hospitalDB.syncQueue.toArray()).toMatchObject([{ status: 'FAILED' }]);
          } else {
            expect(after?.date).toBe(date);
            expect(Object.keys(after?.beds ?? {})).toEqual(Object.keys(baseRecord().beds));
            expect(Object.keys(after ?? {}).some(key => key.includes('.'))).toBe(false);
            expect(await hospitalDB.syncQueue.count()).toBe(0);
          }
          const otherDevice = await actor('A', () =>
            getRecordFromFirestore(date, { source: 'server' })
          );
          if (role === 'doctor_urgency') expect(otherDevice).toBeNull();
          else {
            expect(otherDevice?.beds.R2.clinicalEpisodeId).toBe('synthetic-episode-R2');
            if (label === 'bed') expect(otherDevice?.beds.R1.pathology).toBe('EDITADO');
            if (label === 'day') expect(otherDevice?.handoffNovedadesDayShift).toBe('EDITADO');
            if (label === 'staff') expect(otherDevice?.nursesDayShift).toContain('ENFERMERA NUEVA');
          }
          expect(result.savedLocally).toBe(true);
        });
      }
    }
  }
  it('never creates a partial day when the transport reports not-found', async () => {
    transport.missing = true;
    const result = await patch('B', { handoffNovedadesDayShift: 'EDITADO' }).then(
      () => 'accepted',
      () => 'rejected'
    );
    const remote = (await admin.doc(dayPath).get()).data();
    console.log('Missing-target transport result', { result, remote });
    expect(remote).toBeUndefined();
    expect(result).toBe('rejected');
  });
});
