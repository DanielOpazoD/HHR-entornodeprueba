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
import * as fence from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  presentSyncOutcomeFeedback,
  resolvePatchOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  setFirestoreEnabled,
  setFirestoreSyncState,
} from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { resolveRecordBaseRevision } from '@/services/storage/sync/syncTaskContractPolicy';
import {
  createDailyRecordWriteAuthorityFunctions,
  makeCanonicalEmptyBed,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
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
type Route = 'authority' | 'transaction';
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
  [
    'nursing handoff novedades',
    'transaction',
    { handoffNovedadesDayShift: 'NOVEDAD A' },
    { handoffNovedadesDayShift: 'NOVEDAD B' },
    'handoffNovedadesDayShift',
  ],
  [
    'active extra beds',
    'transaction',
    { activeExtraBeds: ['E1'] },
    { activeExtraBeds: ['E2'] },
    'activeExtraBeds',
  ],
];
const valueAt = (record: DailyRecord, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], record);
/** The notice the census shows for a patch result, as `useDailyRecordSyncQuery` presents it. */
const shownNotice = (result: DailyRecordWriteResult) => {
  const shown: [channel: string, title: string, message?: string][] = [];
  presentSyncOutcomeFeedback(resolvePatchOutcomeFeedback(result), 'Actualización', {
    success: (title, message) => shown.push(['success', title, message]),
    warning: (title, message) => shown.push(['warning', title, message]),
    error: (title, message) => shown.push(['error', title, message]),
  });
  return shown;
};
const FIELD_CHANGED_NOTICE = [
  [
    'warning',
    'Cambio pendiente de revisión',
    'El campo cambió en otro equipo. La edición pendiente se conserva para revisión.',
  ],
];
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
        baseRecord: base,
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
      await transactionGate?.();
      return atomic(...args);
    });
  };
  let transactionGate: (() => Promise<void>) | undefined;
  /** Resolves for every caller once two have arrived. */
  const arriveTogether = () => {
    let release!: () => void;
    const together = new Promise<void>(done => {
      release = done;
    });
    let arrivals = 0;
    return async () => {
      if (++arrivals === 2) release();
      await together;
    };
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
  /**
   * Starts both writers' transactions together. A version check by a read before the write (the
   * gap closed on 2026-11-15) would also be held after both passed it, so a reopened gap shows up
   * as two «guardado».
   */
  const holdWritesTogether = () => {
    transactionGate = arriveTogether();
    const passed = arriveTogether();
    const check = guards.assertFirestoreConcurrency;
    vi.spyOn(guards, 'assertFirestoreConcurrency').mockImplementation(async (...args) => {
      calls.direct++;
      await check(...args);
      await passed();
    });
  };
  const race = (a: DailyRecordPatch, b: DailyRecordPatch) => {
    holdWritesTogether();
    return Promise.allSettled([patch('A', a), patch('B', b)]);
  };
  const routeOf = (): Route | 'direct' =>
    calls.patch + calls.save > 0 ? 'authority' : calls.transaction > 0 ? 'transaction' : 'direct';
  /** Runs device B's queue until nothing is ready, as its browser would over the next minutes. */
  const settleQueue = async () => {
    let shift = 0;
    for (let round = 0; round < 4; round++) {
      // One read: a task the queue claims between two reads would otherwise end the wait early.
      const tasks = await vi.waitFor(
        async () => {
          const tasks = await hospitalDB.syncQueue.toArray();
          if (tasks.some(task => task.status === 'PROCESSING')) throw new Error('queue busy');
          return tasks;
        },
        { timeout: 20_000, interval: 50 }
      );
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
    transactionGate = undefined;
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

    it(`different fields of the same day: both simultaneous writers are saved (${config})`, async () => {
      await configure(config);
      const results = await race(
        { handoffNovedadesDayShift: 'NOVEDAD A' },
        { activeExtraBeds: ['E2'] }
      );
      expect(routeOf()).toBe('transaction');
      expect(results.map(item => item.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await read()).toMatchObject({
        handoffNovedadesDayShift: 'NOVEDAD A',
        activeExtraBeds: ['E2'],
      });
    });

    it(`the same value written twice at once: both writers succeed (${config})`, async () => {
      await configure(config);
      const same = { handoffNovedadesDayShift: 'NOVEDAD A' };
      const results = await race(same, same);
      expect(results.map(item => item.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await read()).handoffNovedadesDayShift).toBe('NOVEDAD A');
    });
  }

  // Through the app: device B's census save races device A's write of the same novedades.
  it('handoff novedades: one of two simultaneous nurses is saved, the other keeps the text', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    holdWritesTogether();
    const [other, observed] = await Promise.allSettled([
      patch('A', { handoffNovedadesDayShift: 'NOVEDAD A' }),
      actor('B', () =>
        updatePartialDetailed(
          date,
          { handoffNovedadesDayShift: 'NOVEDAD B' },
          { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
        )
      ),
    ]);
    if (observed.status === 'rejected') throw observed.reason;
    const savedB = observed.value.state === 'confirmed';
    expect(calls.direct).toBe(0);
    expect([other.status === 'fulfilled', savedB].filter(Boolean)).toHaveLength(1);
    await settleQueue();
    expect((await read()).handoffNovedadesDayShift).toBe(savedB ? 'NOVEDAD B' : 'NOVEDAD A');
    if (!savedB) {
      expect(shownNotice(observed.value)).toEqual(FIELD_CHANGED_NOTICE);
      expect((await hospitalDB.dailyRecords.get(date))?.handoffNovedadesDayShift).toBe('NOVEDAD B');
      expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
        { status: 'CONFLICT', lastErrorCategory: 'conflict' },
      ]);
    }
  });

  it('the nurse who loses a real race is told the field changed elsewhere, not «integrated»', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    // Both start from the same base; B's transaction opens only after A's write resolved.
    let releaseB!: () => void;
    const aDone = new Promise<void>(done => {
      releaseB = done;
    });
    transactionGate = async () => {
      if (scope.getStore()?.uid === 'synthetic-B') await aDone;
    };
    const [other, observed] = await Promise.allSettled([
      patch('A', { handoffNovedadesDayShift: 'NOVEDAD A' }).finally(() => releaseB()),
      actor('B', () =>
        updatePartialDetailed(
          date,
          { handoffNovedadesDayShift: 'NOVEDAD B' },
          { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
        )
      ),
    ]);
    if (observed.status === 'rejected') throw observed.reason;
    expect(other.status).toBe('fulfilled');
    expect(observed.value).toMatchObject({
      savedHere: true,
      state: 'held',
      reason: 'field_changed_elsewhere',
    });
    expect(shownNotice(observed.value)).toEqual(FIELD_CHANGED_NOTICE);
    await settleQueue();
    expect((await read()).handoffNovedadesDayShift).toBe('NOVEDAD A');
    expect((await hospitalDB.dailyRecords.get(date))?.handoffNovedadesDayShift).toBe('NOVEDAD B');
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { status: 'CONFLICT', lastErrorCategory: 'conflict' },
    ]);
  });

  it('a nurse whose novedades another device replaced first is warned and keeps the text', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    await patch('A', { handoffNovedadesDayShift: 'NOVEDAD A' });
    const result = await actor('B', () =>
      updatePartialDetailed(
        date,
        { handoffNovedadesDayShift: 'NOVEDAD B' },
        { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
      )
    );
    expect(result).toMatchObject({
      savedHere: true,
      state: 'held',
      reason: 'field_changed_elsewhere',
    });
    expect(shownNotice(result)).toEqual(FIELD_CHANGED_NOTICE);
    await settleQueue();
    expect((await read()).handoffNovedadesDayShift).toBe('NOVEDAD A');
    expect((await hospitalDB.dailyRecords.get(date))?.handoffNovedadesDayShift).toBe('NOVEDAD B');
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
      { status: 'CONFLICT', lastErrorCategory: 'conflict' },
    ]);
  });

  it.each<[string, DailyRecordPatch]>([
    ['another field', { activeExtraBeds: ['E2'] }],
    ['the same value', { handoffNovedadesDayShift: 'NOVEDAD A' }],
  ])(
    'a nurse who writes %s after another device saved novedades is saved without a warning',
    async (_label, edit) => {
      await configure('production');
      await hospitalDB.dailyRecords.put(baseRecord());
      await patch('A', { handoffNovedadesDayShift: 'NOVEDAD A' });
      const result = await actor('B', () =>
        updatePartialDetailed(date, edit, {
          authoringSession: captureAuthoringSession(),
          baseRecord: baseRecord(),
        })
      );
      expect(result).toMatchObject({ state: 'confirmed', localCopy: 'current' });
      expect(shownNotice(result).map(([channel]) => channel)).toEqual(['success']);
      expect(await read()).toMatchObject({ handoffNovedadesDayShift: 'NOVEDAD A', ...edit });
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    }
  );

  it('clearing a bed and editing its patient at once: the authority refuses one', async () => {
    await configure('production');
    const base = baseRecord();
    const clear = actor('A', () =>
      writes.updateRecordPartial(
        date,
        { 'beds.R1': makeCanonicalEmptyBed('R1') },
        base.lastUpdated,
        {
          historyPolicy: 'skip',
          intentionalBedClear: {
            bedId: 'R1',
            target: 'bed',
            confirmedLastUpdated: base.lastUpdated,
            confirmedOccupant: base.beds.R1,
          },
          syncContract: {
            mutationId: 'synthetic-A-clear',
            baseRevision: resolveRecordBaseRevision(base),
            changedPaths: ['beds.R1'],
          },
        }
      )
    );
    const results = await Promise.allSettled([clear, patch('B', { 'beds.R1.pathology': 'B' })]);
    expect(calls).toMatchObject({ patch: 2, direct: 0 });
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect((await read()).beds.R1.pathology).toBe(results[0].status === 'fulfilled' ? '' : 'B');
  });

  it('the device that loses a same-field bed edit keeps it as a conflict, never overwrites', async () => {
    await configure('production');
    await hospitalDB.dailyRecords.put(baseRecord());
    await patch('A', { 'beds.R1.pathology': 'A' });
    const result = await actor('B', () =>
      updatePartialDetailed(
        date,
        { 'beds.R1.pathology': 'B' },
        { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
      )
    );
    expect(result).toMatchObject({ savedHere: true, state: 'local', cause: 'merged' });
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
        { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
      )
    );
    expect(offline).toMatchObject({ savedHere: true, state: 'local', cause: 'stored' });
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
        { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
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
      await hospitalDB.dailyRecords.put(baseRecord());
      const result = await actor('B', () =>
        updatePartialDetailed(
          date,
          { 'beds.R1.pathology': 'B' },
          { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
        )
      );
      expect(calls.transaction).toBeGreaterThan(0);
      expect(calls.patch).toBe(1);
      expect(result).toMatchObject({ savedHere: true, state: 'confirmed' });
      expect((await read()).beds.R1.pathology).toBe('B');
      expect(await hospitalDB.syncQueue.count()).toBe(0);
    });

    it('refuses one of two simultaneous same-field bed writers', async () => {
      await configure('production');
      unreadablePolicy();
      const results = await race({ 'beds.R1.pathology': 'A' }, { 'beds.R1.pathology': 'B' });
      // The authority saves the first writer. The second is refused there, or already by the
      // transaction when it reads the first one's value before the rules refuse its write.
      expect(calls.patch).toBeGreaterThan(0);
      expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
      expect((await read()).beds.R1.pathology).toBe(results[0].status === 'fulfilled' ? 'A' : 'B');
    });
  });
});
