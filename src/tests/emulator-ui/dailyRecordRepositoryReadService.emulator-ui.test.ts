import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { HospitalConfigService } from '@/services/config/HospitalConfigService';
import {
  getAuthoritativeForDate,
  getForDateWithMeta,
  getLocalForDate,
  getMonthRecords,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore/firestoreRecordQueries';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync/publicSyncQueue';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { captureAuthoringSession } from '@/services/storage/authoringSession';

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  // The emulator accepts «owner» as an administrator token: the REST absence check that
  // follows a missing day reaches the emulator, never a real Firebase project.
  auth: {
    currentUser: {
      uid: 'synthetic-n5d5-reader',
      email: 'hospitalizados@hospitalhangaroa.cl',
      isAnonymous: false,
      getIdToken: async () => 'owner',
    },
  },
  storage: {},
  functions: {},
  getStorageInstance: vi.fn().mockResolvedValue({}),
  getFunctionsInstance: vi.fn().mockResolvedValue({}),
  firebaseReady: Promise.resolve(),
  mountConfigWarning: vi.fn(),
}));

const host = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = host ? describe : describe.skip;
const date = '2026-03-19';
const recordPath = (id: string) => `hospitals/hanga_roa/dailyRecords/${id}`;

const buildRecord = (
  lastUpdated: string,
  beds: Record<string, unknown> = {},
  id: string = date
): DailyRecord =>
  ({
    date: id,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNightReceives: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    schemaVersion: 1,
  }) as unknown as DailyRecord;

const newPatient = (fields: Record<string, unknown>) => ({
  bedId: 'R1',
  patientName: 'PACIENTE NUEVO',
  rut: '11.111.111-1',
  admissionDate: date,
  admissionTime: '08:00',
  ...fields,
});

describeEmulator('daily record read service against the real server and local store', () => {
  let environment: RulesTestEnvironment;
  let reader: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

  beforeAll(async () => {
    const config = resolveFirestoreRulesEmulatorConfig(host);
    if (!['127.0.0.1', 'localhost'].includes(config.host))
      throw new Error('Local emulator required');
    // The required CLI launcher loads firestore.rules; they are not uploaded again here.
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-n5d5-read-service',
      firestore: config,
    });
  });

  beforeEach(async () => {
    vi.stubEnv('VITE_FIRESTORE_EMULATOR_HOST', host);
    HospitalConfigService.setHospitalId('hanga_roa');
    setFirestoreEnabled(true);
    await environment.clearFirestore();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    // A fresh SDK instance per case: no cache or listener view survives from another case.
    reader = environment
      .authenticatedContext(`synthetic-n5d5-reader-${Math.random().toString(36).slice(2)}`, {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
    activeDb = reader;
  });

  afterEach(async () => {
    await reader.enableNetwork();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  const seedServer = (...records: DailyRecord[]) =>
    environment.withSecurityRulesDisabled(async context => {
      const batch = context.firestore().batch();
      for (const record of records)
        batch.set(context.firestore().doc(recordPath(record.date)), record);
      await batch.commit();
    });

  /** Reads the server copy once online, then goes offline: later reads see only that cache. */
  const cacheServerCopyThenGoOffline = async () => {
    expect((await getRecordFromFirestoreDetailed(date)).serverConfirmed).toBe(true);
    await reader.disableNetwork();
  };

  const storedLocal = async () => (await hospitalDB.dailyRecords.get(date)) ?? null;

  it.each([
    {
      scenario: 'local is newer than the cached server copy',
      local: buildRecord('2026-03-19T12:00:00.000Z', {
        R1: { bedId: 'R1', patientName: 'LOCAL PATIENT', pathology: 'LOCAL DX' },
      }),
      remote: buildRecord('2026-03-19T08:00:00.000Z', {
        R2: { bedId: 'R2', patientName: 'REMOTE NEW PATIENT', pathology: 'REMOTE NEW DX' },
      }),
      expectBeds: (beds: DailyRecord['beds']) => {
        expect(beds.R1.pathology).toBe('LOCAL DX');
        expect(beds.R2).toBeUndefined();
      },
    },
    {
      scenario: 'first status and specialty of a new patient while Firebase still has them empty',
      local: buildRecord('2026-03-19T12:00:05.000Z', {
        R1: newPatient({ status: PatientStatus.GRAVE, specialty: Specialty.MEDICINA }),
      }),
      remote: buildRecord('2026-03-19T12:00:00.000Z', {
        R1: newPatient({
          clinicalEpisodeId: 'ep_r1_generated',
          status: PatientStatus.EMPTY,
          specialty: Specialty.EMPTY,
        }),
      }),
      expectBeds: (beds: DailyRecord['beds']) => {
        expect(beds.R1.status).toBe(PatientStatus.GRAVE);
        expect(beds.R1.specialty).toBe(Specialty.MEDICINA);
        expect(beds.R1.clinicalEpisodeId).toBeUndefined();
      },
    },
    {
      scenario: 'fast diagnosis and specialty edits while Firebase only has the status',
      local: buildRecord('2026-03-19T12:00:05.000Z', {
        R1: newPatient({
          pathology: 'Neumonia adquirida en la comunidad',
          specialty: Specialty.MEDICINA,
          status: PatientStatus.DE_CUIDADO,
        }),
      }),
      remote: buildRecord('2026-03-19T12:00:08.000Z', {
        R1: newPatient({
          clinicalEpisodeId: 'ep_r1_generated',
          pathology: '',
          specialty: Specialty.EMPTY,
          status: PatientStatus.DE_CUIDADO,
        }),
      }),
      expectBeds: (beds: DailyRecord['beds']) => {
        expect(beds.R1.pathology).toBe('Neumonia adquirida en la comunidad');
        expect(beds.R1.specialty).toBe(Specialty.MEDICINA);
        expect(beds.R1.status).toBe(PatientStatus.DE_CUIDADO);
        expect(beds.R1.clinicalEpisodeId).toBeUndefined();
      },
    },
  ])(
    'keeps the local copy when the server answer is only the offline cache: $scenario',
    async ({ local, remote, expectBeds }) => {
      await seedServer(remote);
      await cacheServerCopyThenGoOffline();
      await hospitalDB.dailyRecords.put(local);

      const result = await getForDateWithMeta(date);

      expect(result.source).toBe('indexeddb');
      expect(result.sourceOfTruth).toBe('local');
      expect(result.consistencyState).toBe('local_authoritative');
      expect(result.serverConfirmed).toBe(false);
      expect(result.record?.lastUpdated).toBe(local.lastUpdated);
      expectBeds(result.record!.beds);
      expect(await storedLocal()).toEqual(local);
    }
  );

  it('hydrates the local copy when the server confirms a newer record', async () => {
    await hospitalDB.dailyRecords.put(buildRecord('2026-03-19T08:00:00.000Z'));
    await seedServer({
      ...buildRecord('2026-03-19T12:00:00.000Z'),
      nursesDayShift: ['Synthetic remote nurse'],
    });

    const result = await getForDateWithMeta(date);

    expect(result.source).toBe('firestore');
    expect(result.consistencyState).toBe('remote_authoritative');
    expect(result.serverConfirmed).toBe(true);
    expect(result.record?.lastUpdated).toBe('2026-03-19T12:00:00.000Z');
    expect(result.record?.nursesDayShift).toEqual(['Synthetic remote nurse']);
    expect(await storedLocal()).toMatchObject({
      lastUpdated: '2026-03-19T12:00:00.000Z',
      nursesDayShift: ['Synthetic remote nurse'],
    });
  });

  it('returns the exact server census for structural planning while a local edit is pending', async () => {
    const local = buildRecord('2026-03-19T12:00:05.000Z', {
      R1: { bedId: 'R1', patientName: 'PATIENT', clinicalEpisodeId: 'episode-move' },
    });
    const accepted = await queueDailyRecordSyncTaskWithLocalRecord(local, undefined, {
      authoringSession: captureAuthoringSession(),
      deferProcessing: true,
    });
    expect(accepted.accepted).toBe(true);
    await seedServer(
      buildRecord('2026-03-19T12:00:00.000Z', {
        R4: { bedId: 'R4', patientName: 'PATIENT', clinicalEpisodeId: 'episode-move' },
      })
    );

    const authoritative = await getAuthoritativeForDate(date);

    expect(authoritative?.beds.R4.clinicalEpisodeId).toBe('episode-move');
    expect(authoritative?.beds.R1?.clinicalEpisodeId).not.toBe('episode-move');
    expect(await storedLocal()).toEqual(local);
    expect(await hospitalDB.syncQueue.count()).toBe(1);
    // The ordinary read keeps the pending edit, which is why structural planning cannot use it.
    const ordinary = await getForDateWithMeta(date);
    expect(ordinary.record?.beds.R1.clinicalEpisodeId).toBe('episode-move');
    expect(ordinary.record?.beds.R4).toBeUndefined();
    expect(await storedLocal()).toEqual(local);
  });

  it('never answers structural planning from the offline cache', async () => {
    await seedServer(buildRecord('2026-03-19T12:00:00.000Z'));
    await cacheServerCopyThenGoOffline();

    await expect(getAuthoritativeForDate(date)).rejects.toThrow();
  });

  it('returns the exact local candidate without merging the server census', async () => {
    const local = buildRecord('2026-03-19T12:00:05.000Z', {
      R1: { bedId: 'R1', patientName: 'LOCAL PATIENT', clinicalEpisodeId: 'episode-move' },
    });
    await hospitalDB.dailyRecords.put(local);
    await seedServer({
      ...buildRecord('2026-03-19T13:00:00.000Z'),
      nursesDayShift: ['Synthetic remote nurse'],
    });

    expect(await getLocalForDate(date)).toEqual(local);
    expect(await storedLocal()).toEqual(local);
  });

  it('falls back to the local copy, retryable, when the server cannot be read', async () => {
    const local = buildRecord('2026-03-19T08:00:00.000Z');
    await hospitalDB.dailyRecords.put(local);
    await seedServer(buildRecord('2026-03-19T12:00:00.000Z'));
    await reader.disableNetwork();

    const result = await getForDateWithMeta(date);

    expect(result.source).toBe('indexeddb');
    expect(result.record?.lastUpdated).toBe(local.lastUpdated);
    expect(result.sourceOfTruth).toBe('local');
    expect(result.retryability).toBe('automatic_retry');
    expect(await storedLocal()).toEqual(local);
  });

  it('rejects a failed server read without a local copy instead of reporting a missing day', async () => {
    await seedServer(buildRecord('2026-03-19T12:00:00.000Z'));
    await reader.disableNetwork();

    await expect(getForDateWithMeta(date)).rejects.toThrow('offline');
    expect(await storedLocal()).toBeNull();
  });

  it('returns an explicit missing result when neither local nor server has the record', async () => {
    const result = await getForDateWithMeta(date);

    expect(result.source).toBe('not_found');
    expect(result.record).toBeNull();
    expect(result.serverConfirmed).toBe(true);
    expect(result.consistencyState).toBe('missing');
    expect(result.retryability).toBe('manual_retry');
    expect(result.userSafeMessage).toBe('No hay registro disponible para este día.');
    expect(await storedLocal()).toBeNull();
  });

  it('loads only the requested month from the server', async () => {
    await seedServer(
      ...['2026-02-28', '2026-03-01', '2026-03-19', '2026-04-01'].map(id =>
        buildRecord(`${id}T12:00:00.000Z`, {}, id)
      )
    );

    const records = await getMonthRecords(2026, 2);

    expect(records.map(record => record.date)).toEqual(['2026-03-01', '2026-03-19']);
  });
});
