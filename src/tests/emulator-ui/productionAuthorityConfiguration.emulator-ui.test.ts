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
import * as guards from '@/services/storage/firestore/firestoreWriteSupport';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import * as fence from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
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
const policyPath = 'hospitals/hanga_roa/settings/rayenImportPolicy';
// Own emulator project: other two-user rehearsals run in parallel on the same day document.
const projectId = 'demo-hhr-autoridad-produccion';
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

/**
 * `production`: what the published app runs since 2026-11-07 — the schema-v2 Rayen policy with
 * `clinicalBatchMode: "enforced"` and VITE_DAILY_RECORD_AUTHORITY_MODE left undefined.
 * `variable_and_policy`: the same policy plus the variable set to `enforced`.
 */
const configs = ['production', 'variable_and_policy'] as const;
type Config = (typeof configs)[number];
type Route = 'authority' | 'transaction' | 'direct';
type Row = [label: string, route: Route, a: DailyRecordPatch, b: DailyRecordPatch, path: string];

// Each row is two different values for the SAME field, written from the same base at once.
const serialized: Row[] = [
  [
    'clinical bed field',
    'authority',
    { 'beds.R1.pathology': 'A' },
    { 'beds.R1.pathology': 'B' },
    'beds.R1.pathology',
  ],
  [
    'non-clinical bed field',
    'authority',
    { 'beds.R1.age': '51' },
    { 'beds.R1.age': '62' },
    'beds.R1.age',
  ],
  [
    'staffing',
    'transaction',
    { nursesDayShift: ['ENFERMERA A', ''] },
    { nursesDayShift: ['ENFERMERA B', ''] },
    'nursesDayShift',
  ],
];
const direct: Row[] = [
  [
    'nursing handoff novedades',
    'direct',
    { handoffNovedadesDayShift: 'NOVEDAD A' },
    { handoffNovedadesDayShift: 'NOVEDAD B' },
    'handoffNovedadesDayShift',
  ],
  [
    'active extra beds',
    'direct',
    { activeExtraBeds: ['E1'] },
    { activeExtraBeds: ['E2'] },
    'activeExtraBeds',
  ],
];
const valueAt = (record: DailyRecord, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], record);
const normalize = (value: unknown) =>
  Array.isArray(value) ? value.filter(item => item !== '') : value;

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
  const configure = async (config: Config) => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', config === 'production' ? '' : 'enforced');
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', '');
    await admin.doc(policyPath).set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
  };
  /** Holds every direct write after its version check until both writers passed it. */
  const holdDirectWritesTogether = () => {
    let release!: () => void;
    const together = new Promise<void>(done => {
      release = done;
    });
    let arrivals = 0;
    const check = guards.assertFirestoreConcurrency;
    vi.spyOn(guards, 'assertFirestoreConcurrency').mockImplementation(async (...args) => {
      calls.direct++;
      await check(...args);
      if (++arrivals === 2) release();
      await together;
    });
  };
  const countDirectWrites = () => {
    const check = guards.assertFirestoreConcurrency;
    vi.spyOn(guards, 'assertFirestoreConcurrency').mockImplementation(async (...args) => {
      calls.direct++;
      return check(...args);
    });
  };
  const race = (a: DailyRecordPatch, b: DailyRecordPatch) => {
    holdDirectWritesTogether();
    return Promise.allSettled([patch('A', a), patch('B', b)]);
  };
  const routeOf = (): Route =>
    calls.patch + calls.save > 0 ? 'authority' : calls.transaction > 0 ? 'transaction' : 'direct';
  /** Runs device B's queue until nothing is ready, as its browser would over the next minutes. */
  const settleQueue = async () => {
    let shift = 0;
    for (let round = 0; round < 4; round++) {
      await vi.waitFor(
        async () => {
          const tasks = await hospitalDB.syncQueue.toArray();
          if (tasks.some(task => task.status === 'PROCESSING')) throw new Error('queue busy');
        },
        { timeout: 20_000, interval: 50 }
      );
      const tasks = await hospitalDB.syncQueue.toArray();
      if (!tasks.some(task => task.status === 'PENDING' || task.status === 'FAILED')) return;
      shift += 10 * 60_000;
      const now = Date.now() + shift;
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
    await env.clearFirestore();
    // Isolated fake IndexedDB only; never operate on a browser's real outbox.
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    // The observed browser is device B, admitted for its signed-in nurse.
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
    setFirestoreEnabled(true);
    await admin.doc(dayPath).set(baseRecord());
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

  for (const config of configs) {
    for (const [label, route, a, b, path] of serialized) {
      it(`${label}: the ${route} refuses one of two simultaneous writers (${config})`, async () => {
        await configure(config);
        const results = await race(a, b);
        expect(routeOf()).toBe(route);
        expect(calls.direct).toBe(0);
        expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(item => item.status === 'rejected')).toMatchObject([
          { reason: { name: 'ConcurrencyError' } },
        ]);
        const kept = results[0].status === 'fulfilled' ? a : b;
        expect(normalize(valueAt(await read(), path))).toEqual(normalize(Object.values(kept)[0]));
      });
    }

    it(`full-day save: the authority refuses one of two simultaneous saves (${config})`, async () => {
      await configure(config);
      const save = (id: 'A' | 'B', value: string) => {
        const record = baseRecord();
        record.beds.R1.pathology = value;
        return actor(id, () =>
          writes.saveRecordToFirestore(record, record.lastUpdated, {
            syncContract: {
              mutationId: `synthetic-${id}-save`,
              baseRevision: resolveRecordBaseRevision(record),
              changedPaths: ['*'],
            },
          })
        );
      };
      const results = await Promise.allSettled([save('A', 'A'), save('B', 'B')]);
      expect(calls.save).toBe(2);
      expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(item => item.status === 'rejected')).toMatchObject([
        { reason: { name: 'ConcurrencyError' } },
      ]);
      expect((await read()).beds.R1.pathology).toBe(results[0].status === 'fulfilled' ? 'A' : 'B');
    });

    for (const [label, , a, b, path] of direct) {
      it(`${label}: neither the policy nor the variable routes it away from Firestore (${config})`, async () => {
        await configure(config);
        await race(a, b);
        expect(calls).toMatchObject({ patch: 0, save: 0, transaction: 0, direct: 2 });
        expect([a, b].map(item => normalize(Object.values(item)[0]))).toContainEqual(
          normalize(valueAt(await read(), path))
        );
      });

      // Measured gap (E8, 2026-11-12): a plain day field is checked by a read and then written
      // with updateDoc. Two writers inside that window both pass the check and both are told
      // «guardado»; the later write replaces the earlier text. Not closed by policy or variable.
      it.fails(
        `${label}: two simultaneous writers must not both be told saved (${config})`,
        async () => {
          await configure(config);
          const results = await race(a, b);
          expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
        }
      );
    }
  }

  it('the device that loses a same-field bed edit keeps it as a conflict, never overwrites', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    await patch('A', { 'beds.R1.pathology': 'A' });
    const result = await actor('B', () =>
      updatePartialDetailed(date, { 'beds.R1.pathology': 'B' }, { baseRecord: baseRecord() })
    );
    expect(result).toMatchObject({ savedLocally: true, updatedRemotely: false });
    await settleQueue();
    expect((await read()).beds.R1.pathology).toBe('A');
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { status: 'CONFLICT', lastErrorCategory: 'conflict' },
    ]);
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('B');
  });

  it('an offline bed edit is queued and replayed through the authority when back online', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
    const offline = await actor('B', () =>
      updatePartialDetailed(
        date,
        { 'beds.R1.pathology': 'B OFFLINE' },
        { baseRecord: baseRecord() }
      )
    );
    expect(offline).toMatchObject({ savedLocally: true, updatedRemotely: false });
    expect(await hospitalDB.syncQueue.count()).toBe(1);
    setFirestoreEnabled(true);
    await settleQueue();
    expect(calls.save).toBeGreaterThan(0);
    expect(calls.direct).toBe(0);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
    expect((await read()).beds.R1.pathology).toBe('B OFFLINE');
  });

  it('an offline bed edit replayed after another device changed that field stays a conflict', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
    await actor('B', () =>
      updatePartialDetailed(
        date,
        { 'beds.R1.pathology': 'B OFFLINE' },
        { baseRecord: baseRecord() }
      )
    );
    await patch('A', { 'beds.R1.pathology': 'A ONLINE' });
    setFirestoreEnabled(true);
    await settleQueue();
    expect(calls.direct).toBe(0);
    expect((await read()).beds.R1.pathology).toBe('A ONLINE');
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([{ status: 'CONFLICT' }]);
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('B OFFLINE');
  });

  describe('a browser that cannot read the policy', () => {
    // The two advisory reads return what their catch branches return when getDoc fails.
    const unreadablePolicy = () => {
      vi.spyOn(fence, 'isServerClinicalWriteFenceActive').mockResolvedValue(false);
      vi.spyOn(fence, 'resolveEffectiveDailyRecordAuthorityMode').mockResolvedValue('client_only');
    };

    it('still saves a bed edit through the authority after the rules refuse the direct write', async () => {
      await configure('production');
      unreadablePolicy();
      countDirectWrites();
      await hospitalDB.dailyRecords.put(baseRecord());
      const result = await actor('B', () =>
        updatePartialDetailed(date, { 'beds.R1.pathology': 'B' }, { baseRecord: baseRecord() })
      );
      expect(calls.direct).toBeGreaterThan(0);
      expect(calls.patch).toBe(1);
      expect(result).toMatchObject({ savedLocally: true, updatedRemotely: true });
      expect((await read()).beds.R1.pathology).toBe('B');
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    });

    it('refuses one of two simultaneous same-field bed writers', async () => {
      await configure('production');
      unreadablePolicy();
      const results = await race({ 'beds.R1.pathology': 'A' }, { 'beds.R1.pathology': 'B' });
      expect(calls.patch).toBe(2);
      expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
      expect((await read()).beds.R1.pathology).toBe(results[0].status === 'fulfilled' ? 'A' : 'B');
    });
  });
});
