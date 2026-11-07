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
const projectId = 'demo-hhr-dos-usuarios';
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
  const mode = async (value: 'enforced') => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', value);
    if (value === 'enforced')
      await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2,
        mode: 'preview',
        revision: 1,
        clinicalBatchMode: 'enforced',
      });
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
  });
  beforeEach(async () => {
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

  it.each(['patient', 'episode'] as const)(
    'retains an equal original field after the bed changes %s',
    async change => {
      await mode('enforced');
      const base = baseRecord();
      await hospitalDB.dailyRecords.put(base);
      setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
      await actor('A', () =>
        updatePartialDetailed(
          date,
          { 'beds.R1.pathology': 'ONLY FOR THE ORIGINAL EPISODE' },
          { baseRecord: base }
        )
      );
      const [pending] = await hospitalDB.syncQueue.toArray();
      await admin.doc(dayPath).update({
        'beds.R1': {
          ...base.beds.R1,
          ...(change === 'patient'
            ? { patientName: 'OTHER SYNTHETIC PATIENT', rut: '99999999-9' }
            : { clinicalEpisodeId: 'another-synthetic-episode' }),
        },
        'meta.revision': 2,
        lastUpdated: new Date().toISOString(),
      });
      setFirestoreEnabled(true);

      await publish();

      const stored = await read();
      expect(stored.beds.R1.pathology).toBe('BASE');
      expect(stored.beds.R1.clinicalEpisodeId).toBe(
        change === 'patient' ? base.beds.R1.clinicalEpisodeId : 'another-synthetic-episode'
      );
      expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
        { status: 'CONFLICT', payload: pending.payload },
      ]);
    }
  );

  // Case 5 from the rehearsal is now a positive contract, with real-collision controls.
  it.each([
    'different-bed',
    'different-field',
    'same-field',
    'hidden-same-field',
    'equal-version',
    'legacy',
    'race-after-read',
  ] as const)('5 authority offline replay: %s', async scenario => {
    await mode('enforced');
    await hospitalDB.dailyRecords.put(baseRecord());
    setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
    const offline = await actor('A', () =>
      updatePartialDetailed(
        date,
        { 'beds.R1.pathology': 'A OFFLINE' },
        { baseRecord: baseRecord() }
      )
    );
    expect(offline).toMatchObject({ savedLocally: true, updatedRemotely: false });
    const [pending] = await hospitalDB.syncQueue.toArray();
    expect(pending.patchBaseValues).toMatchObject({ 'beds.R1.pathology': 'BASE' });
    const collision = scenario === 'same-field' || scenario === 'hidden-same-field';
    await patch(
      'B',
      collision
        ? { 'beds.R1.pathology': 'B ONLINE' }
        : scenario === 'different-field'
          ? { 'beds.R1.age': '51' }
          : { 'beds.R2.pathology': 'B ONLINE' }
    );
    if (scenario === 'hidden-same-field')
      await patch('B', { 'beds.R2.pathology': 'B LATER' }, await read());
    if (scenario === 'equal-version')
      await admin.doc(dayPath).update({ lastUpdated: baseRecord().lastUpdated });
    if (scenario === 'legacy')
      await hospitalDB.syncQueue.update(pending.id!, { patchBaseValues: undefined });
    if (scenario === 'race-after-read') {
      const save = authority.saveDailyRecordWithClinicalAuthorityCallable;
      vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementationOnce(
        async (...args) => {
          await patch('B', { 'beds.R1.pathology': 'B CONCURRENT' }, await read());
          return save(...args);
        }
      );
    }
    setFirestoreEnabled(true);
    await publish();
    const stored = await read();
    const tasks = await hospitalDB.syncQueue.toArray();
    if (collision || scenario === 'legacy' || scenario === 'race-after-read') {
      expect(tasks).toMatchObject([{ status: 'CONFLICT', payload: pending.payload }]);
      expect(stored.beds.R1.pathology).toBe(
        collision ? 'B ONLINE' : scenario === 'legacy' ? 'BASE' : 'B CONCURRENT'
      );
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('A OFFLINE');
    } else {
      expect(tasks).toHaveLength(0);
      expect(stored.beds.R1.pathology).toBe('A OFFLINE');
      if (scenario === 'different-field') expect(stored.beds.R1.age).toBe('51');
      else expect(stored.beds.R2.pathology).toBe('B ONLINE');
      expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('A OFFLINE');
    }
  });
});
