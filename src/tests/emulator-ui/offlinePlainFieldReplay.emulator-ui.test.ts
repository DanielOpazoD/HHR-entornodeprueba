/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as writes from '@/services/storage/firestore/firestoreRecordWrites';
import * as guards from '@/services/storage/firestore/firestoreWriteSupport';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { FIELD_CHANGED_ELSEWHERE_MESSAGE } from '@/services/storage/syncErrorCatalog';
import { resolveRecordBaseRevision } from '@/services/storage/sync/syncTaskContractPolicy';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

// Bind SDK/auth per async writer; a mutable global DB would mix the two devices mid-write.
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

const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
// Own emulator project: other two-user suites run in parallel on the same day document.
const projectId = 'demo-hhr-offline-plain-field-replay';
const baseRecord = () => ({
  ...DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-01-01T00:00:00.000Z',
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    nursesDayShift: ['ENFERMERA BASE', ''],
    handoffNovedadesDayShift: 'NOVEDAD BASE',
    handoffNovedadesNightShift: 'NOCHE BASE',
    activeExtraBeds: [],
    beds: {
      ...DataFactory.createMockDailyRecord(date).beds,
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'PACIENTE SINTETICO 1',
        rut: '12.345.678-5',
        admissionDate: date,
        clinicalEpisodeId: 'synthetic-episode-R1',
        pathology: 'BASE',
        age: '40',
      }),
    },
  }),
  meta: { revision: 1 },
});

// No real Firebase config, credentials, Functions endpoint or patient data are loaded.
const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('an offline edit resent by the queue', () => {
  let env: RulesTestEnvironment;
  let app: App;
  let admin: Firestore;
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  let clients: Record<'A' | 'B', { db: unknown; uid: string; role: string }>;
  const calls = { authority: 0, fieldTransaction: 0 };
  const actor = <T>(id: 'A' | 'B', action: () => T): T => scope.run(clients[id], action);
  const read = async () => {
    const data = (await admin.doc(dayPath).get()).data();
    if (!data) throw new Error('Synthetic census missing');
    return docToRecord(
      { ...data, lastUpdated: (data.lastUpdated as Timestamp).toDate().toISOString() },
      date
    );
  };
  /** Device A, online, writes from the day both devices started with. */
  const writeOnA = (data: DailyRecordPatch) =>
    actor('A', () =>
      writes.updateRecordPartial(date, data, baseRecord().lastUpdated, {
        historyPolicy: 'skip',
        baseRecord: baseRecord(),
        syncContract: {
          mutationId: `synthetic-A-${Object.keys(data).join('-')}`,
          baseRevision: resolveRecordBaseRevision(baseRecord()),
          changedPaths: Object.keys(data),
        },
      })
    );
  /** Device B edits as the census does; its SDK has no network and an empty cache. */
  const editOnB = async (data: DailyRecordPatch) => {
    const local = (await hospitalDB.dailyRecords.get(date)) ?? baseRecord();
    return actor('B', () =>
      updatePartialDetailed(date, data, {
        authoringSession: captureAuthoringSession(),
        baseRecord: local as DailyRecord,
      })
    );
  };
  const queue = () => hospitalDB.syncQueue.toArray();
  /** Device B's queue over the next half hour: each round moves its clock past any retry wait. */
  const runQueueOnB = async () => {
    for (let round = 1; round <= 3; round++) {
      const now = Date.now() + round * 10 * 60_000;
      await actor('B', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
          await processSyncQueue();
        } finally {
          clock.mockRestore();
        }
      });
    }
  };
  const offlineB = async () => {
    const db = env
      .authenticatedContext('synthetic-B', { email: 'doctor@example.com', role: 'nurse_hospital' })
      .firestore() as unknown as {
      disableNetwork(): Promise<void>;
      enableNetwork(): Promise<void>;
    };
    clients.B = { db, uid: 'synthetic-B', role: 'nurse_hospital' };
    await db.disableNetwork();
    return db;
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
    app = initializeApp({ projectId }, 'offline-plain-field-replay');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin,
      Timestamp,
      resolveRoleForEmail: async () => scope.getStore()?.role ?? 'nurse_hospital',
    });
    clients = {
      A: {
        uid: 'synthetic-A',
        role: 'nurse_hospital',
        db: env
          .authenticatedContext('synthetic-A', {
            email: 'hospitalizados@hospitalhangaroa.cl',
            role: 'nurse_hospital',
          })
          .firestore(),
      },
      B: { uid: 'synthetic-B', role: 'nurse_hospital', db: undefined },
    };
  });
  beforeEach(async () => {
    await env.clearFirestore();
    // Isolated fake IndexedDB only; never operate on a browser's real outbox.
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
    setFirestoreEnabled(true);
    // What production runs since 2026-11-07: the schema-v2 policy with enforced clinical batches.
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', '');
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', '');
    await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
    await admin.doc(dayPath).set(baseRecord());
    await hospitalDB.dailyRecords.put(baseRecord());
    calls.authority = calls.fieldTransaction = 0;
    const context = () => ({
      auth: {
        uid: scope.getStore()?.uid,
        token: { email: `${scope.getStore()?.uid}@example.invalid` },
      },
    });
    // Only the callable transport is replaced: the shipped handler runs its real admin transaction.
    vi.spyOn(authority, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        calls.authority++;
        try {
          return await api.patchDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
    vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        calls.authority++;
        try {
          return await api.saveDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
    const fieldTransaction = guards.updateRecordPartiallyAtomically;
    vi.spyOn(guards, 'updateRecordPartiallyAtomically').mockImplementation(async (...args) => {
      calls.fieldTransaction++;
      return fieldTransaction(...args);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await env?.cleanup();
    await admin?.terminate();
    if (app) await deleteApp(app);
  });

  /** B edits offline, A changes the day meanwhile, B reconnects and its queue resends. */
  const offlineEditThenReconnect = async (onB: DailyRecordPatch[], onA: DailyRecordPatch) => {
    const db = await offlineB();
    for (const data of onB) {
      const result = await editOnB(data);
      // Kept on this device and queued: nothing says «guardado».
      expect(result.updatedRemotely).toBe(false);
    }
    const queued = await queue();
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every(task => task.status === 'PENDING')).toBe(true);
    await writeOnA(onA);
    calls.authority = calls.fieldTransaction = 0;
    await db.enableNetwork();
    await runQueueOnB();
    return queued.length;
  };

  it('keeps both changes when the other device changed another field, without a notice', async () => {
    const tasks = await offlineEditThenReconnect(
      [{ handoffNovedadesDayShift: 'OFFLINE B' }, { activeExtraBeds: ['E1'] }],
      { handoffNovedadesNightShift: 'NOCHE A' }
    );

    expect(await read()).toMatchObject({
      handoffNovedadesDayShift: 'OFFLINE B',
      activeExtraBeds: ['E1'],
      handoffNovedadesNightShift: 'NOCHE A',
    });
    expect(await queue()).toEqual([]);
    // The device adopts the committed day, the other device's field included.
    expect(await hospitalDB.dailyRecords.get(date)).toMatchObject({
      handoffNovedadesDayShift: 'OFFLINE B',
      handoffNovedadesNightShift: 'NOCHE A',
    });
    expect(calls).toEqual({ authority: 0, fieldTransaction: tasks });
  });

  it('ends without a conflict when the other device wrote the same value', async () => {
    await offlineEditThenReconnect([{ handoffNovedadesDayShift: 'MISMO TEXTO' }], {
      handoffNovedadesDayShift: 'MISMO TEXTO',
    });

    expect((await read()).handoffNovedadesDayShift).toBe('MISMO TEXTO');
    expect(await queue()).toEqual([]);
  });

  it('keeps the edit as a conflict, without writing or retrying, when the same field changed to another value', async () => {
    await offlineEditThenReconnect([{ handoffNovedadesDayShift: 'OFFLINE B' }], {
      handoffNovedadesDayShift: 'NOVEDAD A',
    });
    const writtenByA = await read();

    expect(writtenByA.handoffNovedadesDayShift).toBe('NOVEDAD A');
    const [task] = await queue();
    expect(task).toMatchObject({ status: 'CONFLICT' });
    expect(task.error).toContain(FIELD_CHANGED_ELSEWHERE_MESSAGE);
    expect((task.payload as DailyRecord).handoffNovedadesDayShift).toBe('OFFLINE B');
    expect((await hospitalDB.dailyRecords.get(date))?.handoffNovedadesDayShift).toBe('OFFLINE B');
    // Further rounds neither retry nor drop it, and the server keeps A's version untouched.
    const retries = task.retryCount;
    calls.fieldTransaction = 0;
    await runQueueOnB();
    expect(await queue()).toEqual([
      expect.objectContaining({ status: 'CONFLICT', retryCount: retries }),
    ]);
    expect(calls.fieldTransaction).toBe(0);
    expect((await read()).lastUpdated).toBe(writtenByA.lastUpdated);
  });

  it('still sends a bed field with its base version, never by the per-field check', async () => {
    await offlineEditThenReconnect([{ 'beds.R1.age': '41' }], {
      handoffNovedadesNightShift: 'NOCHE A',
    });

    expect(calls.fieldTransaction).toBe(0);
    expect(calls.authority).toBeGreaterThan(0);
    expect((await read()).beds.R1.age).toBe('40');
    expect((await queue()).map(task => task.status)).toEqual(['CONFLICT']);
  });
});
