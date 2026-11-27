/* @flake-safe: Today's synthetic census satisfies the real rules' hospital write window. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { captureAuthoringSession } from '@/services/session/authoringSession';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  presentSyncOutcomeFeedback,
  resolvePatchOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { asDexieDatabase } from '@/tests/helpers/dexieTestDatabase';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { processSyncQueue } from '@/services/storage/sync';
import { SESSION_OWNER_KEY } from '@/services/session/sessionOwnerKey';
import { buildAtomicPatientMovementPatch } from '@/features/census/controllers/atomicPatientMovementPatchController';
import {
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/features/census/controllers/patientMovementCreationController';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { buildClearPatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { BEDS } from '@/constants/beds';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

// Bind SDK/auth per async writer; a mutable global DB would mix the two devices mid-write.
const { scope } = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return { scope: new AsyncLocalStorage<{ db: unknown; uid: string; role: string }>() };
});
vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
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
// Own emulator project: other rehearsals run in parallel on the same day document.
const projectId = 'demo-hhr-movimiento-desde-cama';
const ANA = { bedId: 'R1', patientName: 'ANA SINTETICA', rut: '12.345.678-5' };
const BRUNO = { bedId: 'R2', patientName: 'BRUNO SINTETICO', rut: '11.111.111-1' };
type Person = typeof ANA;

const baseRecord = (): DailyRecord =>
  ({
    ...DataFactory.createMockDailyRecord(date, {
      lastUpdated: '2026-01-01T00:00:00.000Z',
      dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
      discharges: [],
      transfers: [],
      cma: [],
      // Every canonical bed is stored, as on a real day; only R1 and R2 are occupied.
      beds: {
        ...DataFactory.createMockDailyRecord(date).beds,
        ...Object.fromEntries(
          [ANA, BRUNO].map(person => [
            person.bedId,
            DataFactory.createMockPatient(person.bedId, {
              patientName: person.patientName,
              rut: person.rut,
              admissionDate: date,
              clinicalEpisodeId: `synthetic-episode-${person.bedId}`,
              pathology: 'BASE',
              age: '40',
            }),
          ])
        ),
      },
    }),
    meta: { revision: 1 },
  }) as DailyRecord;

type Movement = 'discharges' | 'transfers' | 'cma';
// Each builder uses the controllers the census modals call, so the patch carries the movement
// list and the freed bed, as the census sends it.
const movementPatch = (movement: Movement, person: Person, base: DailyRecord): DailyRecordPatch => {
  if (movement === 'discharges') {
    const resolution = resolveAddDischargeMovement({
      record: base,
      bedId: person.bedId,
      payload: {
        status: 'Vivo',
        type: 'Domicilio (Habitual)',
        time: '10:00',
        dischargeTarget: 'both',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });
    if (!resolution.ok) throw new Error(`discharge not resolved: ${resolution.error.code}`);
    return buildAtomicPatientMovementPatch({
      updatedRecord: resolution.value.updatedRecord,
      movementKey: 'discharges',
      sourceBedIds: [person.bedId],
    });
  }
  if (movement === 'transfers') {
    const resolution = resolveAddTransferMovement({
      record: base,
      bedId: person.bedId,
      payload: {
        evacuationMethod: 'Avión comercial',
        receivingCenter: 'Hospital Salvador',
        receivingCenterOther: '',
        transferEscort: '',
        time: '10:00',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });
    if (!resolution.ok) throw new Error(`transfer not resolved: ${resolution.error.code}`);
    return buildAtomicPatientMovementPatch({
      updatedRecord: resolution.value.updatedRecord,
      movementKey: 'transfers',
      sourceBedIds: [person.bedId],
    });
  }
  // As useCMA.addCMA builds it from a bed: the entry plus the bed cleared by its controller.
  const entry = {
    id: `cma-${person.bedId}`,
    bedName: person.bedId,
    originalBedId: person.bedId,
    patientName: person.patientName,
    rut: person.rut,
    age: '40',
    diagnosis: 'SINTETICO',
    specialty: 'Cirugía',
    interventionType: 'Cirugía Mayor Ambulatoria' as const,
    clinicalEpisodeId: `synthetic-episode-${person.bedId}`,
    timestamp: new Date().toISOString(),
  };
  return buildAtomicPatientMovementPatch({
    updatedRecord: {
      ...base,
      cma: [...(base.cma || []), entry],
      beds: {
        ...base.beds,
        [person.bedId]: buildClearPatientPatches(base, person.bedId)[
          `beds.${person.bedId}`
        ] as DailyRecord['beds'][string],
      },
    } as DailyRecord,
    movementKey: 'cma',
    sourceBedIds: [person.bedId],
  });
};

const shownNotices = (result: DailyRecordWriteResult) => {
  const shown: string[] = [];
  const record = (title: string, message?: string) => shown.push(`${title} · ${message ?? ''}`);
  presentSyncOutcomeFeedback(resolvePatchOutcomeFeedback(result), 'Actualización', {
    success: record,
    warning: record,
    error: record,
  });
  return shown;
};

const movedNames = (record: DailyRecord | undefined, movement: Movement) =>
  ((record?.[movement] ?? []) as { patientName: string; deleted?: boolean }[])
    .filter(item => !item.deleted)
    .map(item => item.patientName);

const enabled = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1';
(enabled ? describe : describe.skip)('a movement that frees a bed, saved by one person', () => {
  let env: RulesTestEnvironment;
  let app: App;
  let admin: Firestore;
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  let clients: Record<'A' | 'B', { db: unknown; uid: string; role: string }>;
  const createdOrigins: string[] = [];
  const actor = <T>(id: 'A' | 'B', action: () => T): T => scope.run(clients[id], action);
  const readRemote = async () => {
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
  const context = () => ({
    auth: {
      uid: scope.getStore()?.uid,
      token: { email: `${scope.getStore()?.uid}@example.invalid` },
    },
  });
  const write = (id: 'A' | 'B', patch: DailyRecordPatch, base: DailyRecord) =>
    actor(id, () =>
      updatePartialDetailed(date, patch, {
        authoringSession: captureAuthoringSession(),
        baseRecord: base,
      })
    );
  // Waits for the queue to go idle; a task left to retry is processed once more with the clock
  // moved past its backoff, as the browser runtime would.
  const settleQueue = async (id: 'A' | 'B') => {
    let shift = 0;
    for (let round = 0; round < 4; round++) {
      const tasks = await vi.waitFor(
        async () => {
          const current = await hospitalDB.syncQueue.toArray();
          if (current.some(task => task.status === 'PROCESSING')) throw new Error('queue busy');
          return current;
        },
        { timeout: 20_000, interval: 50 }
      );
      if (!tasks.some(task => task.status === 'PENDING' || task.status === 'FAILED')) return;
      shift += 10 * 60_000;
      const now = Date.now() + shift;
      await actor(id, async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
          await processSyncQueue();
        } finally {
          clock.mockRestore();
        }
      });
    }
  };
  const onCreateTask = (_key: unknown, task: { origin?: string }) => {
    createdOrigins.push(String(task.origin));
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
    app = initializeApp({ projectId }, 'movement-from-bed-single-writer');
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
    asDexieDatabase(hospitalDB).syncQueue.hook('creating', onCreateTask);
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    createdOrigins.length = 0;
    localStorage.clear();
    localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B');
    setFirestoreEnabled(true);
    // `production`: the schema-v2 Rayen policy with `clinicalBatchMode: "enforced"` and the
    // variable left undefined, what the published app runs since 2026-11-07.
    await admin.doc(policyPath).set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
    await admin.doc(dayPath).set(baseRecord());
    await hospitalDB.dailyRecords.put(baseRecord());
    // Only the callable transport is replaced: the real handler runs against the emulator.
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
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setFirestoreEnabled(true);
  });
  afterAll(async () => {
    asDexieDatabase(hospitalDB).syncQueue.hook('creating').unsubscribe(onCreateTask);
    await env?.cleanup();
    await admin?.terminate();
    if (app) await deleteApp(app);
  });

  it.each(['discharges', 'transfers', 'cma'] as const)(
    '%s from a bed: one queue task saves the day, with no merge, conflict or notice',
    async movement => {
      const base = await readRemote();
      const result = await write('B', movementPatch(movement, ANA, base), base);

      expect(result).toMatchObject({ state: 'local', cause: 'queue_route' });
      expect(shownNotices(result)).toEqual([]);

      await settleQueue('B');
      expect(createdOrigins).toEqual(['direct_queue']);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
      const remote = await readRemote();
      expect(movedNames(remote, movement)).toEqual([ANA.patientName]);
      expect(remote.beds[ANA.bedId].patientName).toBe('');
      expect(remote.beds[BRUNO.bedId].patientName).toBe(BRUNO.patientName);
    }
  );

  it('keeps the second device discharge in its queue as a conflict when the first saved before', async () => {
    const base = await readRemote();
    await write('A', movementPatch('discharges', ANA, base), base);
    await settleQueue('A');
    expect(movedNames(await readRemote(), 'discharges')).toEqual([ANA.patientName]);

    // Device B: its own copy and queue, still on the base it read before A saved.
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.put(base);
    createdOrigins.length = 0;
    const result = await write('B', movementPatch('discharges', BRUNO, base), base);
    expect(shownNotices(result).join('\n')).not.toMatch(/integró/);
    await settleQueue('B');

    const remote = await readRemote();
    expect(movedNames(remote, 'discharges')).toEqual([ANA.patientName]);
    expect(remote.beds[BRUNO.bedId].patientName).toBe(BRUNO.patientName);
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks.map(task => [task.origin, task.status])).toEqual([['direct_queue', 'CONFLICT']]);
    expect(movedNames(tasks[0].payload as DailyRecord, 'discharges')).toEqual([BRUNO.patientName]);
    expect(movedNames(await hospitalDB.dailyRecords.get(date), 'discharges')).toEqual([
      BRUNO.patientName,
    ]);
  });
});
