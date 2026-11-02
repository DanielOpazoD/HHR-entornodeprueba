/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as writes from '@/services/storage/firestore/firestoreRecordWrites';
import * as guards from '@/services/storage/firestore/firestoreWriteSupport';
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

const require = createRequire(import.meta.url);
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-dos-usuarios';
const modes = ['client_only', 'enforced'] as const;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
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
  let clinical: ReturnType<typeof createRayenClinicalEnrichmentFunctions>;
  let clients: Record<'A' | 'B', { db: unknown; uid: string; role: string }>;
  let nurseB: typeof clients.B;
  const useDoctor = () => {
    clients.B = {
      uid: 'synthetic-B-doctor',
      role: 'doctor_urgency',
      db: env
        .authenticatedContext('synthetic-B-doctor', {
          email: 'doctor@example.com',
          role: 'doctor_urgency',
        })
        .firestore(),
    };
  };
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
  const mode = async (value: (typeof modes)[number]) => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', value);
    if (value === 'enforced')
      await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2,
        mode: 'preview',
        revision: 1,
        clinicalBatchMode: 'enforced',
      });
  };
  const race = async (a: DailyRecordPatch, b: DailyRecordPatch, direct: boolean) => {
    if (direct) {
      const checked = deferred();
      let arrivals = 0;
      const check = guards.assertFirestoreConcurrency;
      vi.spyOn(guards, 'assertFirestoreConcurrency').mockImplementation(async (...args) => {
        await check(...args);
        if (++arrivals === 2) checked.resolve();
        await checked.promise;
      });
    }
    // Both direct checks see the SAME real base before either updateDoc is released.
    return Promise.allSettled([patch('A', a), patch('B', b)]);
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
    clinical = createRayenClinicalEnrichmentFunctions(dependencies);
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

  for (const selected of modes) {
    it.each([
      ['1 different beds', { 'beds.R2.pathology': 'B' }],
      ['2 different fields', { 'beds.R1.age': '51' }],
    ] as const)(`%s: retains both accepted edits (${selected})`, async (_label, b) => {
      await mode(selected);
      const results = await race({ 'beds.R1.pathology': 'A' }, b, selected === 'client_only');
      if (selected === 'client_only') {
        expect(results.map(item => item.status)).toEqual(['fulfilled', 'fulfilled']);
      } else {
        expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(item => item.status === 'rejected')).toMatchObject([
          { reason: { name: 'ConcurrencyError' } },
        ]);
        if (results[0].status === 'rejected')
          await patch('A', { 'beds.R1.pathology': 'A' }, await read());
        else await patch('B', b, await read());
      }
      const stored = await read();
      expect(stored.beds.R1.pathology).toBe('A');
      if ('beds.R2.pathology' in b) expect(stored.beds.R2.pathology).toBe('B');
      else expect(stored.beds.R1.age).toBe('51');
    });
  }

  it('3 authority rejects one simultaneous same-field edit explicitly (SAVE-01)', async () => {
    await mode('enforced');
    const results = await race({ 'beds.R1.pathology': 'A' }, { 'beds.R1.pathology': 'B' }, false);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected')).toMatchObject([
      { reason: { name: 'ConcurrencyError' } },
    ]);
    expect(['A', 'B']).toContain((await read()).beds.R1.pathology);
  });

  // Pending accepted by the owner until after 2026-11-08: concurrent direct same-field writes.
  it.fails(
    '3 SAVE-01: direct simultaneous same-field writes must not both report success',
    async () => {
      const results = await race({ 'beds.R1.pathology': 'A' }, { 'beds.R1.pathology': 'B' }, true);
      expect(['A', 'B']).toContain((await read()).beds.R1.pathology);
      expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    }
  );

  it('4 Eloisa batch and a manual edit serialize; a fresh-base retry preserves both', async () => {
    await mode('enforced');
    const policy = (await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').get()).data();
    await admin.doc(dayPath).update({
      rayenSyncHistory: [
        {
          id: 'synthetic-run',
          sourceDate: date,
          status: 'applied',
          policy,
        },
      ],
    });
    const batch = (base: DailyRecord) =>
      actor('A', () =>
        clinical.applyRayenClinicalEnrichmentBatch.run(
          {
            date,
            authorityDate: date,
            runId: 'synthetic-run',
            mutationId: 'synthetic-batch',
            expectedLastUpdated: base.lastUpdated,
            baseRevision: resolveRecordBaseRevision(base),
            mode: 'enforced',
            fieldContractVersion: 2,
            clientRuntimeContractVersion: 3,
            patches: [
              {
                bedId: 'R1',
                clinicalEpisodeId: 'synthetic-episode-R1',
                fields: { vitalSigns: { temperature: 36.7 } },
              },
            ],
          },
          context()
        )
      );
    const results = await Promise.allSettled([
      patch('B', { 'beds.R2.pathology': 'MEDICO' }),
      batch(baseRecord()),
    ]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    if (results[0].status === 'rejected') {
      expect(results[0].reason).toMatchObject({ name: 'ConcurrencyError' });
      await patch('B', { 'beds.R2.pathology': 'MEDICO' }, await read());
    } else {
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'aborted' } });
      await batch(await read());
    }
    expect((await read()).beds.R2.pathology).toBe('MEDICO');
    expect((await admin.doc(dayPath).get()).data()?.beds.R1.vitalSigns.temperature).toBe(36.7);
  });

  // Authority replay belongs to the active offline-edit-other-bed branch; do not duplicate it.
  for (const selected of ['client_only'] as const) {
    for (const path of ['beds.R2.pathology', 'beds.R1.pathology'] as const) {
      // Pending accepted by the owner until after 2026-11-08: direct replay overwrites a peer.
      const knownFailure = path === 'beds.R1.pathology';
      const testCase = knownFailure ? it.fails : it;
      testCase(`5 offline replay after B edits ${path} (${selected})`, async () => {
        await mode(selected);
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
        expect(pending.payload).toMatchObject({ beds: { R1: { pathology: 'A OFFLINE' } } });
        await patch(
          'B',
          path === 'beds.R1.pathology'
            ? { 'beds.R1.pathology': 'B ONLINE' }
            : { 'beds.R2.pathology': 'B ONLINE' }
        );
        setFirestoreEnabled(true);
        await publish();
        const stored = await read();
        const tasks = await hospitalDB.syncQueue.toArray();
        if (path === 'beds.R2.pathology') {
          if (tasks.length) {
            expect(tasks).toMatchObject([{ status: 'CONFLICT', payload: pending.payload }]);
            expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('A OFFLINE');
            expect(stored.beds.R2.pathology).toBe('B ONLINE');
          }
          expect(tasks).toHaveLength(0);
          expect(stored.beds.R1.pathology).toBe('A OFFLINE');
          expect(stored.beds.R2.pathology).toBe('B ONLINE');
        } else {
          // SAVE-01: do not silently replace the other device's confirmed same-field edit.
          expect(stored.beds.R1.pathology).toBe('B ONLINE');
          expect(tasks).toMatchObject([{ status: 'CONFLICT', payload: pending.payload }]);
          expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.pathology).toBe('A OFFLINE');
        }
      });
    }
  }

  // Case 6 is already exercised through the real UI hook + emulator in dailyRecordSyncQuery
  // and dailyRecordServerConfirmation. Do not replace that evidence with another storage-only test.
  it('7 simultaneous staffing transaction and doctor authority patch retain accepted work', async () => {
    await mode('enforced');
    useDoctor();
    const staffing = { nursesDayShift: ['ENFERMERA NUEVA', ''] };
    const bed = { 'beds.R1.pathology': 'MEDICO' };
    const results = await Promise.allSettled([patch('A', staffing), patch('B', bed)]);
    expect(results.some(item => item.status === 'fulfilled')).toBe(true);
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(guards.ConcurrencyError);
        await patch(index === 0 ? 'A' : 'B', index === 0 ? staffing : bed, await read());
      }
    }
    const stored = await read();
    expect(stored.nursesDayShift).toEqual(['ENFERMERA NUEVA']);
    expect(stored.beds.R1.pathology).toBe('MEDICO');
  });
  it.each(['bed-first', 'staffing-first'] as const)(
    '7 staffing CAS vs a doctor bed edit: %s preserves both after explicit conflict/reload',
    async order => {
      await mode('enforced');
      useDoctor();
      const staffing = { nursesDayShift: ['ENFERMERA NUEVA', ''] };
      if (order === 'bed-first') {
        await patch('B', { 'beds.R1.pathology': 'MEDICO' });
        await expect(patch('A', staffing)).rejects.toMatchObject({
          name: 'ConcurrencyError',
          message: expect.stringContaining('dotación'),
        });
        await patch('A', staffing, await read());
      } else {
        await patch('A', staffing);
        await expect(patch('B', { 'beds.R1.pathology': 'MEDICO' })).rejects.toBeInstanceOf(
          guards.ConcurrencyError
        );
        await patch('B', { 'beds.R1.pathology': 'MEDICO' }, await read());
      }
      const stored = await read();
      expect(stored.nursesDayShift).toEqual(['ENFERMERA NUEVA']);
      expect(stored.beds.R1.pathology).toBe('MEDICO');
    }
  );
});
