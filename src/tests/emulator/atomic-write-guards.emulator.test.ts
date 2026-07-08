/* @flake-safe: Date usage aligns emulator write-window assertions with current execution time. */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

const runEmulatorTests =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeEmulator = runEmulatorTests ? describe : describe.skip;

let activeDb: unknown;
type TestFirestore = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;

vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));

import {
  ConcurrencyError,
  saveRecordToFirestore,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { assertNoPatientErasures } from '@/services/repositories/dailyRecordRemoteWriteController';
import { DataRegressionError } from '@/utils/integrityGuard';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { clearAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { clearAllSyncQueue } from '@/services/storage/sync';

const buildRecord = (date: string, lastUpdated: string): DailyRecord => ({
  date,
  beds: {},
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
  dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
});

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Movido',
  rut: '22.222.222-2',
  age: '40a',
  pathology: 'Diagnostico base',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-10',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const buildEmptyBed = (bedId: string): PatientData =>
  buildPatient(bedId, {
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    status: PatientStatus.EMPTY,
    admissionDate: '',
    hasWristband: true,
  });

const CURRENT_RECORD_DATE = new Date().toISOString().slice(0, 10);

const isoAt = (date: string, time: string): string => `${date}T${time}.000Z`;

describeEmulator('Firestore emulator atomic write guards', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-atomic-write-guards-test',
      firestore: {
        rules,
        host: emulatorConfig.host,
        port: emulatorConfig.port,
      },
    });

    nurseDb = testEnv
      .authenticatedContext('user_nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await clearAllRecords();
    await clearAllSyncQueue();
    setFirestoreEnabled(true);
    activeDb = nurseDb;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('aborts an erasing full-save inside the transaction and preserves the remote patient', async () => {
    const date = CURRENT_RECORD_DATE;

    // The cloud holds an admitted patient in R1.
    const remote = buildRecord(date, isoAt(date, '10:00:00'));
    remote.beds = {
      R1: buildPatient('R1', { patientName: 'Paciente Crítico', rut: '5.555.555-5' }),
    };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remote);
    });

    // R1 is empty locally with no movement explaining it, yet the base version MATCHES remote, so
    // there is no concurrency conflict (the CAS passes) and no missing-base conflict either. The
    // only thing between this content erasure and a committed write is the in-transaction backstop,
    // exactly as saveDetailed wires it in production.
    const local = buildRecord(date, isoAt(date, '10:00:00'));
    local.beds = { R1: buildEmptyBed('R1') };

    await expect(
      saveRecordToFirestore(local, isoAt(date, '10:00:00'), {
        assertSafeOverwrite: remoteData =>
          assertNoPatientErasures(docToRecord(remoteData, date), local),
      })
    ).rejects.toBeInstanceOf(DataRegressionError);

    // The transaction never committed: the cloud patient survives untouched.
    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.beds.R1.patientName).toBe('Paciente Crítico');
    expect(persisted?.beds.R1.rut).toBe('5.555.555-5');
  });

  it('commits an emptied-bed full-save when a discharge accounts for the patient', async () => {
    const date = CURRENT_RECORD_DATE;
    const baseline = isoAt(date, '10:00:00');

    const remote = buildRecord(date, baseline);
    remote.beds = {
      R1: buildPatient('R1', { patientName: 'Paciente Dado de Alta', rut: '6.666.666-6' }),
    };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remote);
    });

    // R1 is empty locally, but a discharge on that bed explains it — the guard must allow the save.
    const local = buildRecord(date, baseline);
    local.beds = { R1: buildEmptyBed('R1') };
    local.discharges = [
      {
        id: 'd1',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente Dado de Alta',
        rut: '6.666.666-6',
        diagnosis: 'Resuelto',
        time: '11:00',
        status: 'Vivo',
      },
    ] as DailyRecord['discharges'];

    await expect(
      saveRecordToFirestore(local, baseline, {
        assertSafeOverwrite: remoteData =>
          assertNoPatientErasures(docToRecord(remoteData, date), local),
      })
    ).resolves.toBeUndefined();

    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.beds.R1.patientName).toBe('');
  });

  it('serializes two concurrent full-saves on the same base: exactly one wins, the other conflicts', async () => {
    const date = CURRENT_RECORD_DATE;
    // A base safely in the past so the winning write's real now-timestamp is unambiguously newer
    // than the shared base, making the loser's CAS fire deterministically.
    const base = new Date(Date.now() - 60_000).toISOString();

    const seed = buildRecord(date, base);
    seed.beds = {
      R1: buildPatient('R1', { patientName: 'Paciente Carrera', pathology: 'Base' }),
    };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(seed);
    });

    // Two sessions load the SAME base and each edits the same patient differently.
    const editA = buildRecord(date, base);
    editA.beds = {
      R1: buildPatient('R1', { patientName: 'Paciente Carrera', pathology: 'Edit A' }),
    };
    const editB = buildRecord(date, base);
    editB.beds = {
      R1: buildPatient('R1', { patientName: 'Paciente Carrera', pathology: 'Edit B' }),
    };

    const results = await Promise.allSettled([
      saveRecordToFirestore(editA, base),
      saveRecordToFirestore(editB, base),
    ]);

    // The real Firestore transaction serializes them: exactly one commits, the other reads the
    // winner's newer version and aborts with ConcurrencyError — no lost update, no interleaving.
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConcurrencyError);

    // The surviving record is internally consistent: the patient is intact and the diagnosis is
    // exactly one of the two edits.
    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.beds.R1.patientName).toBe('Paciente Carrera');
    expect(['Edit A', 'Edit B']).toContain(persisted?.beds.R1.pathology);
  });
});
