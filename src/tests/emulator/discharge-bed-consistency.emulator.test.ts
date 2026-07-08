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

import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  clearAllRecords,
  getRecordForDate,
  saveRecord,
} from '@/services/storage/indexeddb/indexedDbRecordService';
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

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData =>
  ({
    bedId,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'Paciente Egresado',
    rut: '33.333.333-3',
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
  }) as PatientData;

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

const CURRENT_RECORD_DATE = '2026-05-16';
const isoAt = (date: string, time: string): string => `${date}T${time}.000Z`;

describeEmulator('Firestore discharge-bed consistency flow', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-discharge-bed-consistency-test',
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

  it('does not hydrate a stale local bed as active when Firestore already has the discharge', async () => {
    const date = CURRENT_RECORD_DATE;
    const dischargedRut = '33.333.333-3';
    const localStaleRecord = buildRecord(date, isoAt(date, '09:00:00'));
    localStaleRecord.beds = {
      R1: buildPatient('R1', {
        rut: dischargedRut,
        pathology: 'Diagnostico cache antiguo',
      }),
    };

    const remoteDischargedRecord = buildRecord(date, isoAt(date, '10:00:00'));
    remoteDischargedRecord.beds = { R1: buildEmptyBed('R1') };
    remoteDischargedRecord.discharges = [
      {
        id: 'discharge-1',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente Egresado',
        rut: dischargedRut,
        diagnosis: 'Diagnostico remoto',
        admissionDate: '2026-02-10',
        status: 'Vivo',
        dischargeType: 'Domicilio (Habitual)',
        movementDate: date,
        time: '10:00',
      },
    ];

    await saveRecord(localStaleRecord);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set(remoteDischargedRecord);
    });

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.discharges).toHaveLength(1);
    expect(result.record?.beds.R1.patientName).toBe('');
    expect(result.record?.beds.R1.rut).toBe('');

    const hydratedLocal = await getRecordForDate(date);
    expect(hydratedLocal?.beds.R1.patientName).toBe('');
    expect(hydratedLocal?.beds.R1.rut).toBe('');
  });

  it('hydrates Firebase census diagnosis and specialty over stale local values', async () => {
    const date = CURRENT_RECORD_DATE;
    const localStaleRecord = buildRecord(date, isoAt(date, '09:00:00'));
    localStaleRecord.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Censo Cache',
        rut: '55.555.555-5',
        pathology: 'Diagnostico cache antiguo',
        diagnosisComments: 'Comentario cache antiguo',
        specialty: Specialty.PEDIATRIA,
        secondarySpecialty: '',
        status: PatientStatus.GRAVE,
      }),
    };

    const remoteRecord = buildRecord(date, isoAt(date, '10:00:00'));
    remoteRecord.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Censo',
        rut: '44.444.444-4',
        pathology: 'Neumonia adquirida en la comunidad',
        diagnosisComments: 'CURB-65 elevado',
        specialty: Specialty.MEDICINA,
        secondarySpecialty: Specialty.CIRUGIA,
        status: PatientStatus.ESTABLE,
      }),
    };

    await saveRecord(localStaleRecord);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remoteRecord);
    });

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.beds.R1.pathology).toBe('Neumonia adquirida en la comunidad');
    expect(result.record?.beds.R1.patientName).toBe('Paciente Censo');
    expect(result.record?.beds.R1.rut).toBe('44.444.444-4');
    expect(result.record?.beds.R1.diagnosisComments).toBe('CURB-65 elevado');
    expect(result.record?.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(result.record?.beds.R1.secondarySpecialty).toBe(Specialty.CIRUGIA);
    expect(result.record?.beds.R1.status).toBe(PatientStatus.ESTABLE);

    const hydratedLocal = await getRecordForDate(date);
    expect(hydratedLocal?.beds.R1.pathology).toBe('Neumonia adquirida en la comunidad');
    expect(hydratedLocal?.beds.R1.patientName).toBe('Paciente Censo');
    expect(hydratedLocal?.beds.R1.rut).toBe('44.444.444-4');
    expect(hydratedLocal?.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(hydratedLocal?.beds.R1.status).toBe(PatientStatus.ESTABLE);
  });

  it('keeps a newer local narrative note while hydrating Firebase canonical census fields', async () => {
    const date = CURRENT_RECORD_DATE;
    const localRecordWithPendingNarrative = buildRecord(date, isoAt(date, '10:05:00'));
    localRecordWithPendingNarrative.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Firebase sin actualizar',
        rut: '44.444.444-4',
        pathology: 'Diagnostico cache stale',
        specialty: Specialty.PEDIATRIA,
        handoffNote: 'Nota local pendiente de sincronizar',
      }),
    };

    const remoteRecord = buildRecord(date, isoAt(date, '10:00:00'));
    remoteRecord.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Firebase',
        rut: '44.444.444-4',
        pathology: 'Diagnostico Firebase vigente',
        specialty: Specialty.MEDICINA,
        handoffNote: 'Nota remota previa',
      }),
    };

    await saveRecord(localRecordWithPendingNarrative);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remoteRecord);
    });

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.beds.R1.patientName).toBe('Paciente Firebase');
    expect(result.record?.beds.R1.rut).toBe('44.444.444-4');
    expect(result.record?.beds.R1.pathology).toBe('Diagnostico Firebase vigente');
    expect(result.record?.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(result.record?.beds.R1.handoffNote).toBe('Nota local pendiente de sincronizar');

    const hydratedLocal = await getRecordForDate(date);
    expect(hydratedLocal?.beds.R1.patientName).toBe('Paciente Firebase');
    expect(hydratedLocal?.beds.R1.pathology).toBe('Diagnostico Firebase vigente');
    expect(hydratedLocal?.beds.R1.handoffNote).toBe('Nota local pendiente de sincronizar');
  });

  it('does not hydrate an old local handoff note into a different Firebase patient episode', async () => {
    const date = CURRENT_RECORD_DATE;
    const localRecordWithOldNarrative = buildRecord(date, isoAt(date, '10:05:00'));
    localRecordWithOldNarrative.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Antiguo',
        rut: '55.555.555-5',
        admissionDate: '2026-02-10',
        handoffNote: 'Evolucion del paciente antiguo',
      }),
    };

    const remoteRecord = buildRecord(date, isoAt(date, '10:00:00'));
    remoteRecord.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Nuevo Firebase',
        rut: '44.444.444-4',
        admissionDate: date,
        pathology: 'Diagnostico Firebase vigente',
        handoffNote: '',
      }),
    };

    await saveRecord(localRecordWithOldNarrative);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(`hospitals/hanga_roa/dailyRecords/${date}`).set(remoteRecord);
    });

    const result = await getForDateWithMeta(date, true);

    expect(result.record?.beds.R1.patientName).toBe('Paciente Nuevo Firebase');
    expect(result.record?.beds.R1.rut).toBe('44.444.444-4');
    expect(result.record?.beds.R1.handoffNote).toBe('');

    const hydratedLocal = await getRecordForDate(date);
    expect(hydratedLocal?.beds.R1.patientName).toBe('Paciente Nuevo Firebase');
    expect(hydratedLocal?.beds.R1.handoffNote).toBe('');
  });
});
