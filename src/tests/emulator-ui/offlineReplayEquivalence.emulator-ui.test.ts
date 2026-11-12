/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as writes from '@/services/storage/firestore/firestoreRecordWrites';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
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
const projectId = 'demo-hhr-replay-equivalence';
const baseRecord = () => ({
  ...DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-01-01T00:00:00.000Z',
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    nursesDayShift: ['ENFERMERA BASE', ''],
    beds: Object.fromEntries(
      ['R1', 'R2'].map((bedId, index) => [
        bedId,
        DataFactory.createMockPatient(bedId, {
          patientName: `PACIENTE SINTETICO ${index + 1}`,
          rut: `${index + 1}1111111-1`,
          admissionDate: date,
          clinicalEpisodeId: `synthetic-episode-${bedId}`,
          pathology: 'BASE',
        }),
      ])
    ),
  }),
  meta: { revision: 1 },
});

// No real Firebase config, credentials, Functions endpoint or patient data are loaded.
const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('two independent SDK clients on one synthetic census', () => {
  let env: RulesTestEnvironment;
  let app: App;
  let admin: Firestore;
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  let clients: Record<'A' | 'B', { db: unknown; uid: string; role: string }>;
  let nurseB: typeof clients.B;
  const actor = <T>(id: 'A' | 'B', action: () => T): T => scope.run(clients[id], action);
  const read = async () => {
    const data = (await admin.doc(dayPath).get()).data();
    if (!data) throw new Error('Synthetic census missing');
    return docToRecord(
      {
        ...data,
        lastUpdated:
          data.lastUpdated instanceof Timestamp
            ? data.lastUpdated.toDate().toISOString()
            : data.lastUpdated,
      },
      date
    );
  };
  const patch = (id: 'A' | 'B', data: DailyRecordPatch, base: DailyRecord = baseRecord()) =>
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
        try {
          return await api.patchDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
    vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
      async payload => {
        try {
          return await api.saveDailyRecordWithClinicalAuthority.run(payload, context());
        } catch (error) {
          throw authority.normalizeDailyRecordAuthorityError(error);
        }
      }
    );
  };
  const publish = () =>
    actor('A', async () => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000);
      try {
        await processSyncQueue();
      } finally {
        clock.mockRestore();
      }
    });

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
    app = initializeApp({ projectId }, 'two-users-rehearsal');
    admin = getFirestore(app);
    admin.settings({ ignoreUndefinedProperties: true });
    const dependencies = {
      firestore: admin,
      Timestamp,
      resolveRoleForEmail: async () => scope.getStore()?.role ?? 'nurse_hospital',
    };
    api = createDailyRecordWriteAuthorityFunctions(dependencies);
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
      B: {
        uid: 'synthetic-B',
        role: 'nurse_hospital',
        db: env
          .authenticatedContext('synthetic-B', {
            email: 'doctor@example.com',
            role: 'nurse_hospital',
          })
          .firestore(),
      },
    };
    nurseB = clients.B;
  });
  beforeEach(async () => {
    clients.B = nurseB;
    await env.clearFirestore();
    // Isolated fake IndexedDB only; never operate on a browser's real outbox.
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    setFirestoreEnabled(true);
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
    await admin.doc(dayPath).set(baseRecord());
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

  it.each(['untouched', 'other-field', 'other-bed', 'same-value', 'pending-whitespace', 'mixed', 'whitespace', 'legacy', 'metadata', 'twice', 'null-object', 'object-order'])(
    'replay equivalence %s', async scenario => {
      const base = baseRecord();
      const objectCase = ['null-object', 'object-order'].includes(scenario);
      const field = objectCase ? 'beds.R1.cudyr' : 'beds.R1.pathology';
      if (objectCase) base.beds.R1.cudyr = { feeding: 1, mobility: 2, ...(scenario === 'null-object' ? { reviewNull: null } : {}) } as never;
      await admin.doc(dayPath).set(base);
      await hospitalDB.dailyRecords.put(base);
      setFirestoreSyncState({mode: 'local_only', reason: 'offline'});
      await actor('A', () => updatePartialDetailed(date, {[field]: objectCase ? {feeding: 2, mobility: 2} : 'A OFFLINE', ...(scenario === 'mixed' ? {'beds.R1.age': '51'} : {})}, {baseRecord: base}));
      const [pending] = await hospitalDB.syncQueue.toArray();
      if (scenario === 'legacy') await hospitalDB.syncQueue.update(pending.id!, {patchBaseValues: undefined});
      if (scenario === 'twice') await actor('A', async () => updatePartialDetailed(date, {[field]: 'A SECOND'}, {baseRecord: (await hospitalDB.dailyRecords.get(date))!}));
      if (scenario === 'other-field') await patch('B', {'beds.R1.age': '51'});
      if (scenario === 'other-bed') await patch('B', {'beds.R2.pathology': 'B'});
      if (scenario === 'same-value') await patch('B', {[field]: 'A OFFLINE'});
      if (scenario === 'pending-whitespace' || scenario === 'mixed') await patch('B', {[field]: ' A OFFLINE '});
      if (scenario === 'whitespace') await patch('B', {[field]: ' BASE '});
      if (objectCase) await admin.doc(dayPath).update({[field]: {mobility: 2, feeding: 1}, lastUpdated: new Date().toISOString()});
      if (scenario === 'metadata') await admin.doc(dayPath).update({'meta.serverNote': 'derived', lastUpdated: new Date().toISOString()});
      const beforePublish = (await admin.doc(dayPath).get()).data();
      setFirestoreEnabled(true);
      await publish();
      if (['same-value', 'pending-whitespace'].includes(scenario)) expect((await admin.doc(dayPath).get()).data()).toEqual(beforePublish);
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks).toHaveLength(0);
      if (!objectCase) expect((await read()).beds.R1.pathology).toBe(scenario === 'twice' ? 'A SECOND' : ['pending-whitespace', 'mixed'].includes(scenario) ? ' A OFFLINE ' : 'A OFFLINE');
      if (scenario === 'other-field' || scenario === 'mixed') expect((await read()).beds.R1.age).toBe('51');
      if (scenario === 'other-bed') expect((await read()).beds.R2.pathology).toBe('B');
    }
  );

  it.each(['lost-ack', 'accepted-then-newer', 'two-tasks', 'conflict-intact', 'conflict-whitespace'])( 'replay durability %s', async scenario => {
    const base = baseRecord();
    await hospitalDB.dailyRecords.put(base);
    setFirestoreSyncState({mode:'local_only', reason:'offline'});
    await actor('A', () => updatePartialDetailed(date, {'beds.R1.pathology':'FIRST'}, {baseRecord:base}));
    const [pending] = await hospitalDB.syncQueue.toArray();
    if (scenario === 'two-tasks') {
      const payload = structuredClone(pending.payload) as DailyRecord;
      payload.beds.R1.pathology = 'SECOND';
      await hospitalDB.syncQueue.add({...pending, id: undefined, opId: 'second-independent-task', timestamp: pending.timestamp + 1, payload,
        patchBaseValues: {'beds.R1.pathology':'FIRST'},
        syncContract: {...pending.syncContract, mutationId:'second-independent-mutation'}});
      await hospitalDB.dailyRecords.put(payload);
      expect(await hospitalDB.syncQueue.count()).toBe(2);
    }
    if (scenario.startsWith('conflict-')) await patch('B', {'beds.R1.pathology':scenario === 'conflict-whitespace' ? 'B ' : 'B ONLINE'});
    setFirestoreEnabled(true);
    await publish();
    if (scenario === 'lost-ack') {
      expect(await hospitalDB.syncQueue.count()).toBe(0);
      await hospitalDB.syncQueue.add({...pending, id:undefined});
      await publish();
    }
    if (scenario === 'accepted-then-newer') {
      expect(await hospitalDB.syncQueue.count()).toBe(0);
      await patch('B', {'beds.R1.pathology':'NEWER'}, await read());
      await publish();
    }
    const tasks = await hospitalDB.syncQueue.toArray();
    if (scenario.startsWith('conflict-')) {
      expect((await read()).beds.R1.pathology).toBe(scenario === 'conflict-whitespace' ? 'B ' : 'B ONLINE');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({status:'CONFLICT', payload:pending.payload, patchBaseValues:pending.patchBaseValues, syncContract:pending.syncContract});
    } else {
      expect(tasks).toHaveLength(0);
      expect((await read()).beds.R1.pathology).toBe(scenario === 'two-tasks' ? 'SECOND' : scenario === 'accepted-then-newer' ? 'NEWER' : 'FIRST');
    }
  });

  it('replay durability captured device null leaf', async () => {
    const base = baseRecord();
    base.beds.R1.deviceDetails = {CVC:{installationDate:date}};
    await admin.doc(dayPath).set(base);
    await hospitalDB.dailyRecords.put(base);
    setFirestoreSyncState({mode:'local_only',reason:'offline'});
    await actor('A', () => updatePartialDetailed(date, {'beds.R1.deviceDetails': {CVC:{installationDate:date,note:'A'}}}, {baseRecord:base}));
    const [pending] = await hospitalDB.syncQueue.toArray();
    // Persisted historic base with an empty optional leaf; current Firestore omits it.
    await hospitalDB.syncQueue.update(pending.id!, {patchBaseValues:{'beds.R1.deviceDetails':{CVC:{installationDate:date,note:null}}}});
    await patch('B', {'beds.R2.pathology':'B'});
    setFirestoreEnabled(true);
    await publish();
    expect(await hospitalDB.syncQueue.toArray()).toHaveLength(0);
    expect((await read()).beds.R1.deviceDetails?.CVC.note).toBe('A');
    expect((await read()).beds.R2.pathology).toBe('B');
  });

});
