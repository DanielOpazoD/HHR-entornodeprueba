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

// Focus this suite on Firestore rules + restore mechanics. The audit path (fail-closed outcome
// handling) is covered by the unit test; a no-op audit keeps the restore from depending on the
// audit-write rules/auth in the emulator (there is no authenticated app user here).
vi.mock('@/services/repositories/ports/repositoryAuditPort', async () => ({
  ...(await vi.importActual('@/services/repositories/ports/repositoryAuditPort')),
  logRepositoryConflictVersionRestored: vi.fn().mockResolvedValue(undefined),
  logRepositoryConflictAutoMerged: vi.fn().mockResolvedValue(undefined),
}));

import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';
import { restoreDailyRecordVersion } from '@/services/repositories/dailyRecordVersionRestoreController';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
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
  patientName: 'Paciente',
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

const CURRENT_RECORD_DATE = new Date().toISOString().slice(0, 10);
const isoAt = (date: string, time: string): string => `${date}T${time}.000Z`;

describeEmulator('Firestore emulator conflict version recovery', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;
  let adminDb: TestFirestore;
  let nonManagerDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-conflict-recovery-test',
      firestore: { rules, host: emulatorConfig.host, port: emulatorConfig.port },
    });

    nurseDb = testEnv
      .authenticatedContext('user_nurse', {
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      })
      .firestore();

    adminDb = testEnv
      .authenticatedContext('user_admin', {
        email: 'daniel.opazo@hospitalhangaroa.cl',
        role: 'admin',
      })
      .firestore();

    nonManagerDb = testEnv
      .authenticatedContext('user_doctor', {
        email: 'doctor@hospitalhangaroa.cl',
        role: 'doctor_specialist',
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

  it('captures both pre-merge versions in conflictSnapshots on auto-merge', async () => {
    const date = CURRENT_RECORD_DATE;

    const remote = buildRecord(date, isoAt(date, '10:00:00'));
    remote.beds = { R1: buildPatient('R1', { patientName: 'Remoto', pathology: 'Dx remoto' }) };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remote);
    });

    const incoming = buildRecord(date, isoAt(date, '09:00:00'));
    incoming.beds = { R1: buildPatient('R1', { patientName: 'Local', pathology: 'Dx local' }) };

    await attemptConflictAutoMergeRecovery(date, incoming, ['beds.R1.pathology']);

    // The two pre-merge versions are recoverable, each with `expireAt` for the TTL policy.
    let snapshots: { origin: string; expireAt: unknown; record: unknown }[] = [];
    await testEnv.withSecurityRulesDisabled(async context => {
      const querySnapshot = await context
        .firestore()
        .collection(`hospitals/hanga_roa/dailyRecords/${date}/conflictSnapshots`)
        .get();
      snapshots = querySnapshot.docs.map(snap => snap.data() as never);
    });

    expect(snapshots.map(snap => snap.origin).sort()).toEqual([
      'incoming_premerge',
      'remote_premerge',
    ]);
    expect(snapshots.every(snap => snap.expireAt)).toBe(true);
    expect(snapshots.every(snap => snap.record)).toBe(true);

    const remoteSnap = snapshots.find(snap => snap.origin === 'remote_premerge');
    expect((remoteSnap?.record as DailyRecord)?.beds?.R1?.patientName).toBe('Remoto');
    const incomingSnap = snapshots.find(snap => snap.origin === 'incoming_premerge');
    expect((incomingSnap?.record as DailyRecord)?.beds?.R1?.patientName).toBe('Local');
  });

  it('restores a chosen version (admin) over the live record and snapshots the prior state to history', async () => {
    const date = CURRENT_RECORD_DATE;

    // The state currently live (e.g. the result of a wrong merge) that we want to override.
    const live = buildRecord(date, isoAt(date, '12:00:00'));
    live.beds = { R1: buildPatient('R1', { patientName: 'Estado vivo', pathology: 'Vivo' }) };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(live);
    });

    // A captured conflict version the authorized reviewer chooses to restore.
    const versionToRestore = buildRecord(date, isoAt(date, '10:00:00'));
    versionToRestore.beds = {
      R1: buildPatient('R1', { patientName: 'Versión buena', pathology: 'Buena' }),
    };
    const snapshotId = 'cid__remote_premerge';
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}/conflictSnapshots/${snapshotId}`)
        .set({ origin: 'remote_premerge', conflictId: 'cid', record: versionToRestore });
    });

    // Restore is restricted to clinical conflict managers.
    activeDb = adminDb;
    const result = await restoreDailyRecordVersion(date, snapshotId);
    expect(result.status).toBe('restored');

    // The live record now holds the restored version.
    const restored = await getRecordFromFirestore(date);
    expect(restored?.beds.R1.patientName).toBe('Versión buena');

    // The prior live state is preserved (non-destructive) in the history subcollection.
    let historyPatients: (string | undefined)[] = [];
    await testEnv.withSecurityRulesDisabled(async context => {
      const querySnapshot = await context
        .firestore()
        .collection(`hospitals/hanga_roa/dailyRecords/${date}/history`)
        .get();
      historyPatients = querySnapshot.docs.map(
        snap => (snap.data() as DailyRecord).beds?.R1?.patientName
      );
    });
    expect(historyPatients).toContain('Estado vivo');
  });

  it('allows restore to Hospitalizados HHR nursing: conflictSnapshots reads use the conflict manager policy', async () => {
    const date = CURRENT_RECORD_DATE;
    const live = buildRecord(date, isoAt(date, '11:00:00'));
    live.beds = { R1: buildPatient('R1', { patientName: 'Estado vivo' }) };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(live);
    });

    const snapshotId = 'cid__incoming_premerge';
    const versionToRestore = buildRecord(date, isoAt(date, '10:00:00'));
    versionToRestore.beds = { R1: buildPatient('R1', { patientName: 'Versión enfermería' }) };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}/conflictSnapshots/${snapshotId}`)
        .set({ origin: 'incoming_premerge', conflictId: 'cid', record: versionToRestore });
    });

    activeDb = nurseDb;
    const result = await restoreDailyRecordVersion(date, snapshotId);
    expect(result.status).toBe('restored');

    const restored = await getRecordFromFirestore(date);
    expect(restored?.beds.R1.patientName).toBe('Versión enfermería');
  });

  it('denies restore to a non-manager role: the conflictSnapshots read is blocked by rules', async () => {
    const date = CURRENT_RECORD_DATE;
    const snapshotId = 'cid__remote_premerge';

    const versionToRestore = buildRecord(date, isoAt(date, '10:00:00'));
    versionToRestore.beds = { R1: buildPatient('R1', { patientName: 'Versión buena' }) };
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}/conflictSnapshots/${snapshotId}`)
        .set({ origin: 'remote_premerge', conflictId: 'cid', record: versionToRestore });
    });

    // Non-manager context: the repository call must be denied at the snapshot read — the client UI
    // gate is not the only guard.
    activeDb = nonManagerDb;
    await expect(restoreDailyRecordVersion(date, snapshotId)).rejects.toThrow();
  });
});
