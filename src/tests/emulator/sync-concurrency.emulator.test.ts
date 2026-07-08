/* @flake-safe: Date usage aligns emulator write-window assertions with current execution time. */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDoc } from 'firebase/firestore';
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
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  clearAllRecords,
  getRecordForDate,
  saveRecord,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { clearAllSyncQueue, processSyncQueue } from '@/services/storage/sync';
import {
  buildDetailedStaffingPatch,
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';

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

describeEmulator('Firestore emulator sync concurrency flow', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;
  let adminDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-sync-emulator-test',
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
    adminDb = testEnv
      .authenticatedContext('user_admin', {
        email: 'daniel.opazo@hospitalhangaroa.cl',
        role: 'admin',
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

  it('throws ConcurrencyError when expectedLastUpdated is older than remote', async () => {
    const date = CURRENT_RECORD_DATE;
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set({
          ...buildRecord(date, isoAt(date, '10:00:00')),
          handoffNovedadesDayShift: 'remote',
        });
    });

    const local = buildRecord(date, isoAt(date, '09:59:00'));
    local.handoffNovedadesDayShift = 'local';

    await expect(saveRecordToFirestore(local, isoAt(date, '09:59:00'))).rejects.toBeInstanceOf(
      ConcurrencyError
    );

    let remoteSnap: { data: () => Record<string, unknown> | undefined } | undefined;
    await testEnv.withSecurityRulesDisabled(async context => {
      remoteSnap = await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).get();
    });
    expect(remoteSnap?.data()?.handoffNovedadesDayShift).toBe('remote');
  });

  it('saves when expectedLastUpdated matches remote baseline', async () => {
    const date = CURRENT_RECORD_DATE;
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set({
          ...buildRecord(date, isoAt(date, '09:00:00')),
          handoffNovedadesNightShift: 'remote baseline',
        });
    });

    const local = buildRecord(date, isoAt(date, '09:00:00'));
    local.handoffNovedadesNightShift = 'local update';

    await expect(saveRecordToFirestore(local, isoAt(date, '09:00:00'))).resolves.toBeUndefined();

    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.handoffNovedadesNightShift).toBe('local update');
  });

  it('rejects partial update on missing doc due security rules precondition', async () => {
    const date = CURRENT_RECORD_DATE;

    // Known emulator limitation:
    // Firestore still reports an evaluation error for this denied update against a missing document,
    // even though the effective contract we care about remains stable: the write is rejected with
    // permission-denied and no document is created. See docs/FIRESTORE_RULES_COMPLEXITY_AUDIT.md.
    await expect(
      updateRecordPartial(date, { 'beds.R1.patientName': 'Paciente Fallback' })
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('applies partial update when record exists and is within nurse edit window', async () => {
    const date = CURRENT_RECORD_DATE;
    const now = Date.now();
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set({
          ...buildRecord(date, isoAt(date, '07:00:00')),
          dateTimestamp: now,
        });
    });

    await expect(
      updateRecordPartial(date, {
        'beds.R1.patientName': 'Paciente Parcial',
        'beds.R1.pathology': 'Dx Parcial',
      })
    ).resolves.toBeUndefined();

    const snap = await getDoc(getRecordDocRef(date));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.beds?.R1?.patientName).toBe('Paciente Parcial');
  });

  it('hydrates nurse view with admin-assigned staffing when local cache has stale vacancies', async () => {
    const date = CURRENT_RECORD_DATE;
    const localStaleTimestamp = isoAt(date, '11:00:00');
    const remoteAdminTimestamp = isoAt(date, '10:00:00');

    const remoteAssignedByAdmin = buildRecord(date, remoteAdminTimestamp);
    const staffingDetail = [
      ['day', 'nurse', 0, 'Enf Admin 1'],
      ['day', 'nurse', 1, 'Enf Admin 2'],
      ['day', 'tens', 0, 'TENS Admin 1'],
      ['day', 'tens', 1, 'TENS Admin 2'],
      ['day', 'tens', 2, 'TENS Admin 3'],
      ['night', 'nurse', 0, 'Enf Noche Admin 1'],
      ['night', 'nurse', 1, 'Enf Noche Admin 2'],
      ['night', 'tens', 0, 'TENS Noche Admin 1'],
      ['night', 'tens', 1, 'TENS Noche Admin 2'],
      ['night', 'tens', 2, 'TENS Noche Admin 3'],
    ].reduce(
      (detail, [shift, role, index, name]) =>
        updateDetailedStaffingStandardSlot(
          detail,
          shift as 'day' | 'night',
          role as 'nurse' | 'tens',
          index as number,
          name as string
        ),
      resolveDetailedStaffingState(remoteAssignedByAdmin, date)
    );
    Object.assign(remoteAssignedByAdmin, buildDetailedStaffingPatch(staffingDetail));

    await adminDb.doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remoteAssignedByAdmin);

    const staleNurseCache = buildRecord(date, localStaleTimestamp);
    staleNurseCache.nurses = ['', ''];
    staleNurseCache.nursesDayShift = ['', ''];
    staleNurseCache.nursesNightShift = ['', ''];
    staleNurseCache.tensDayShift = ['', '', ''];
    staleNurseCache.tensNightShift = ['', '', ''];
    await saveRecord(staleNurseCache);

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.nursesDayShift).toEqual(['Enf Admin 1', 'Enf Admin 2']);
    expect(result.record?.nurses).toEqual(['Enf Admin 1', 'Enf Admin 2']);
    expect(result.record?.tensDayShift).toEqual(['TENS Admin 1', 'TENS Admin 2', 'TENS Admin 3']);
    expect(result.record?.nursesNightShift).toEqual(['Enf Noche Admin 1', 'Enf Noche Admin 2']);
    expect(result.record?.tensNightShift).toEqual([
      'TENS Noche Admin 1',
      'TENS Noche Admin 2',
      'TENS Noche Admin 3',
    ]);

    const hydratedLocal = await getRecordForDate(date);
    expect(hydratedLocal?.nursesDayShift).toEqual(['Enf Admin 1', 'Enf Admin 2']);
    expect(hydratedLocal?.tensDayShift).toEqual(['TENS Admin 1', 'TENS Admin 2', 'TENS Admin 3']);
    expect(hydratedLocal?.nursesNightShift).toEqual(['Enf Noche Admin 1', 'Enf Noche Admin 2']);
    expect(hydratedLocal?.tensNightShift).toEqual([
      'TENS Noche Admin 1',
      'TENS Noche Admin 2',
      'TENS Noche Admin 3',
    ]);
  });

  it('hydrates newer Firebase diagnosis over stale local census diagnosis', async () => {
    const date = CURRENT_RECORD_DATE;
    const localTimestamp = isoAt(date, '12:00:00');
    const remoteUpdatedTimestamp = isoAt(date, '12:00:02');

    const localRecord = buildRecord(date, localTimestamp);
    localRecord.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Puérpera',
        rut: '11.111.111-1',
        admissionDate: date,
        pathology: 'Puérpera de cesárea.',
      }),
    };

    const truncatedRemoteRecord = buildRecord(date, remoteUpdatedTimestamp);
    truncatedRemoteRecord.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Puérpera',
        rut: '11.111.111-1',
        admissionDate: date,
        pathology: 'Puérpera',
      }),
    };

    await saveRecord(localRecord);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set(truncatedRemoteRecord);
    });

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.beds.R1.pathology).toBe('Puérpera');

    const hydratedLocal = await getRecordForDate(date);
    expect(hydratedLocal?.beds.R1.pathology).toBe('Puérpera');
  });

  it('auto-merges a conflicted bed move and persists no duplicate patient after retry', async () => {
    const date = CURRENT_RECORD_DATE;
    const staleBaseline = isoAt(date, '09:00:00');
    const remoteUpdated = isoAt(date, '10:00:00');
    const movedRut = '22.222.222-2';

    const localBaseline = buildRecord(date, staleBaseline);
    localBaseline.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Movido',
        rut: movedRut,
        admissionDate: '2026-02-10',
        pathology: 'Diagnostico base',
      }),
      R2: buildEmptyBed('R2'),
    };

    const remoteStillStale = buildRecord(date, remoteUpdated);
    remoteStillStale.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Movido',
        rut: movedRut,
        admissionDate: '2026-02-10',
        pathology: 'Diagnostico remoto antiguo',
      }),
      R2: buildEmptyBed('R2'),
    };

    await saveRecord(localBaseline);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set(remoteStillStale);
    });

    const movedPatient = {
      ...localBaseline.beds.R1,
      bedId: 'R2',
      location: localBaseline.beds.R2.location,
    };
    const clearedSource = {
      ...localBaseline.beds.R2,
      bedId: 'R1',
      location: localBaseline.beds.R1.location,
    };

    await updatePartial(date, {
      'beds.R2': movedPatient,
      'beds.R1': clearedSource,
    });

    const localAfterConflict = await getRecordForDate(date);
    expect(localAfterConflict?.beds.R1.patientName).toBe('');
    expect(localAfterConflict?.beds.R2.patientName).toBe('Paciente Movido');

    await processSyncQueue();

    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.beds.R1.patientName).toBe('');
    expect(persisted?.beds.R1.rut).toBe('');
    expect(persisted?.beds.R2.patientName).toBe('Paciente Movido');
    expect(persisted?.beds.R2.rut).toBe(movedRut);
    expect(persisted?.beds.R2.admissionDate).toBe('2026-02-10');

    const matchingBeds = Object.values(persisted?.beds || {}).filter(
      patient => patient.rut === movedRut
    );
    expect(matchingBeds).toHaveLength(1);
  });

  it('auto-merges a conflicted device retirement without reactivating the removed device', async () => {
    const date = CURRENT_RECORD_DATE;
    const staleBaseline = isoAt(date, '09:00:00');
    const remoteUpdated = isoAt(date, '10:00:00');

    const localBaseline = buildRecord(date, staleBaseline);
    localBaseline.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente con CVC',
        devices: ['CVC', 'VVP#1'],
        deviceDetails: {
          CVC: { installationDate: date },
          'VVP#1': { installationDate: date },
        },
      }),
    };

    const remoteStillStale = buildRecord(date, remoteUpdated);
    remoteStillStale.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente con CVC',
        devices: ['CVC', 'VVP#1'],
        deviceDetails: {
          CVC: { installationDate: date },
          'VVP#1': { installationDate: date },
        },
      }),
    };

    await saveRecord(localBaseline);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set(remoteStillStale);
    });

    const retiredDetails = {
      ...localBaseline.beds.R1.deviceDetails,
      CVC: {
        ...localBaseline.beds.R1.deviceDetails?.CVC,
        removalDate: date,
        note: 'Retirado en turno',
      },
    };

    await updatePartial(date, {
      'beds.R1.deviceDetails': retiredDetails,
      'beds.R1.devices': ['VVP#1'],
    });

    const localAfterConflict = await getRecordForDate(date);
    expect(localAfterConflict?.beds.R1.devices).toEqual(['VVP#1']);
    expect(localAfterConflict?.beds.R1.deviceDetails?.CVC?.removalDate).toBe(date);

    await processSyncQueue();

    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.beds.R1.devices).toEqual(['VVP#1']);
    expect(persisted?.beds.R1.deviceDetails?.CVC?.removalDate).toBe(date);
  });
});
