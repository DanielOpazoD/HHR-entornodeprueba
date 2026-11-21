import * as sdk from 'firebase/firestore';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
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

// The replay's read can be held to let another computer write between it and the write.
vi.mock('firebase/firestore', async original => {
  const actual = await original<typeof import('firebase/firestore')>();
  return { ...actual, getDoc: vi.fn(actual.getDoc) };
});
const date = getTodayISO();
const dayPath = `hospitals/hanga_roa/dailyRecords/${date}`;
const projectId = 'demo-hhr-queued-field-replay';
const baseRecord = () => ({
  ...DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-01-01T00:00:00.000Z',
    dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
    nursesDayShift: ['ENFERMERA BASE', ''],
    handoffNovedadesDayShift: 'BASE DAY',
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
(enabled ? describe : describe.skip)(
  'a queued edit resent field by field stays within main’s guarantees',
  () => {
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
      app = initializeApp({ projectId }, 'queued-field-replay');
      admin = getFirestore(app);
      admin.settings({ ignoreUndefinedProperties: true });
      const dependencies = {
        firestore: admin,
        FieldValue,
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
      const { reconcileAuthorizedSessionOwner } =
        await import('@/services/storage/sessionScopedStorageService');
      await actor('A', () => reconcileAuthorizedSessionOwner('user:synthetic-A'));
      setFirestoreEnabled(true);
      // The schema-v2 policy, as in production: the server owns the bed tree.
      await admin.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2,
        mode: 'preview',
        revision: 1,
        clinicalBatchMode: 'enforced',
      });
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

    const diagnosis = 'beds.R1.pathology';
    const note = 'handoffNovedadesDayShift';
    /** This computer, offline, saves `delta` over `initial`: one durable task. */
    const queue = async (delta: DailyRecordPatch, initial = baseRecord()) => {
      await hospitalDB.dailyRecords.put(initial);
      setFirestoreSyncState({ mode: 'local_only', reason: 'offline' });
      const result = await actor('A', () =>
        updatePartialDetailed(date, delta, {
          baseRecord: initial,
          authoringSession: captureAuthoringSession(),
        })
      );
      expect(result).toMatchObject({ state: 'local' });
      const pending = await hospitalDB.syncQueue.toArray();
      expect(pending).toHaveLength(1);
      return pending[0];
    };
    const drain = async () => {
      setFirestoreEnabled(true);
      await publish();
      return { server: await read(), tasks: await hospitalDB.syncQueue.toArray() };
    };

    // Review of #1859, finding 2: another computer saves the diagnosis between the replay's read and
    // its write. Main keeps that diagnosis and the whole task; the field replay once used the version
    // its own note write returned and wrote over it.
    it.each(['single', 'mixed'])(
      'keeps another computer’s diagnosis saved after the replay read the day (%s)',
      async scenario => {
        const pending = await queue({
          [diagnosis]: 'LOCAL DX',
          ...(scenario === 'mixed' ? { [note]: 'LOCAL DAY' } : {}),
        });
        let peerWrote = false;
        const realGet = vi.mocked(sdk.getDoc).getMockImplementation()!;
        vi.mocked(sdk.getDoc).mockImplementationOnce(async ref => {
          const snapshot = await realGet(ref);
          expect(ref.path).toBe(dayPath);
          await patch('B', { [diagnosis]: 'PEER FIRST' }, await read());
          peerWrote = true;
          return snapshot;
        });
        const { server, tasks } = await drain();
        expect(peerWrote).toBe(true);
        expect(server.beds.R1.pathology).toBe('PEER FIRST');
        expect(server[note]).toBe('BASE DAY');
        expect(tasks).toMatchObject([
          { status: 'CONFLICT', payload: pending.payload, syncContract: pending.syncContract },
        ]);
      }
    );

    // Finding 3: two handoff entries of one episode with different ids. Main merges by id; a field
    // write of the list would replace the one another computer stored.
    it('keeps a handoff entry another computer stored, and this one', async () => {
      const path = 'beds.R1.medicalHandoffEntries';
      const entry = (id: string) => ({ id, specialty: 'Medicina Interna', note: `NOTA ${id}` });
      await queue({ [path]: [entry('local')] });
      await patch('B', { [path]: [entry('peer')] });
      const { server, tasks } = await drain();
      const ids = (entries: { id: string }[] | undefined) => (entries ?? []).map(item => item.id);
      expect(ids(server.beds.R1.medicalHandoffEntries)).toContain('peer');
      expect([
        ...ids(server.beds.R1.medicalHandoffEntries),
        ...tasks.flatMap(task => ids((task.payload as DailyRecord).beds.R1.medicalHandoffEntries)),
      ]).toContain('local');
    });

    // Finding 1 (ID-01): the mother and newborn are replaced by another pair whose newborn has the
    // same provisional name, admission time and derived episode. The name typed for the first
    // newborn never reaches the second, and stays for its own newborn.
    it.each(['accredited', 'legacy'])(
      'never writes a newborn’s name on another mother’s newborn (%s episode)',
      async mode => {
        const { ensurePatientClinicalEpisodeId } =
          await import('@/domain/clinical-episode/clinicalEpisodeIdPolicy');
        const rn = (episode?: string) =>
          ensurePatientClinicalEpisodeId(
            DataFactory.createMockPatient('R1', {
              patientName: 'RN PROVISIONAL',
              rut: '',
              firstName: '',
              lastName: '',
              secondLastName: '',
              identityStatus: 'provisional',
              clinicalEpisodeId: episode,
              admissionDate: date,
              firstSeenDate: date,
              admissionTime: '07:20',
            })
          );
        const base = baseRecord();
        base.beds.R1.clinicalCrib = rn(mode === 'accredited' ? 'ep_rn_a' : undefined);
        await admin.doc(dayPath).set(base);
        await queue({ 'beds.R1.clinicalCrib.patientName': 'NOMBRE PRIMER RN' }, base);
        await admin.doc(dayPath).update({
          'beds.R1': {
            ...base.beds.R2,
            bedId: 'R1',
            rut: '10.000.013-K',
            patientName: 'MADRE NUEVA',
            clinicalEpisodeId: 'ep_madre_nueva',
            clinicalCrib: rn(mode === 'accredited' ? 'ep_rn_b' : undefined),
          },
          'meta.revision': 2,
          lastUpdated: new Date().toISOString(),
        });
        const { server, tasks } = await drain();
        expect(server.beds.R1.clinicalCrib?.patientName).toBe('RN PROVISIONAL');
        expect(
          tasks.some(
            task =>
              (task.payload as DailyRecord).beds.R1.clinicalCrib?.patientName === 'NOMBRE PRIMER RN'
          )
        ).toBe(true);
      }
    );

    // Finding 4: renaming a device moves its details to the new key. A field write of the map would
    // keep the old key beside it; the task ends only with the map as the selector left it.
    it('renames a device chosen offline without leaving its old details behind', async () => {
      const { buildDeviceConfigMutation } =
        await import('@/components/device-selector/deviceSelectorMutationController');
      const { buildDeviceBundleChangeResult } =
        await import('@/features/census/controllers/devicesCellController');
      const base = baseRecord();
      base.beds.R1.devices = ['Drenaje derecho', 'CVC'];
      base.beds.R1.deviceDetails = {
        'Drenaje derecho': { installationDate: date, note: 'ACCESO UNO' },
        CVC: { installationDate: date },
      };
      await admin.doc(dayPath).set(base);
      const change = buildDeviceConfigMutation({
        pendingAddition: null,
        editingDevice: 'Drenaje derecho',
        nextDeviceName: 'Drenaje pleural derecho',
        normalizedDevices: base.beds.R1.devices,
        deviceDetails: base.beds.R1.deviceDetails,
        info: base.beds.R1.deviceDetails['Drenaje derecho'],
      });
      const bundle = buildDeviceBundleChangeResult({
        previousDevices: base.beds.R1.devices,
        nextDevices: change.nextDevices!,
        nextDetails: change.nextDetails!,
        previousHistory: [],
        owner: { clinicalEpisodeId: base.beds.R1.clinicalEpisodeId, patientRut: base.beds.R1.rut },
        renamedDevice: change.renamedDevice,
      });
      await queue(
        {
          'beds.R1.devices': bundle.nextDevices,
          'beds.R1.deviceDetails': bundle.nextDetails,
          'beds.R1.deviceInstanceHistory': bundle.nextHistory,
        },
        base
      );
      const { server, tasks } = await drain();
      expect(server.beds.R1.deviceDetails).toEqual(change.nextDetails);
      expect(tasks).toEqual([]);
    });
  }
);
