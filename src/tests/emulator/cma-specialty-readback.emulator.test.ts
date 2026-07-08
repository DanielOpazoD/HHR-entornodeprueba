import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus } from '@/types/domain/patientClassification';
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

import { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { clearAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';

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

const buildPatient = (bedId: string, specialty: string): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Especialidad Libre',
  rut: '11.111.111-1',
  age: '52a',
  pathology: 'Procedimiento ambulatorio',
  specialty,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-10',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
});

const CURRENT_RECORD_DATE = '2026-03-24';

const isoAt = (date: string, time: string): string => `${date}T${time}.000Z`;

describeEmulator('Firestore emulator CMA specialty readback', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-cma-specialty-emulator-test',
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
    setFirestoreEnabled(true);
    activeDb = nurseDb;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('preserves CMA movements with free-text specialty through Firestore readback', async () => {
    const date = CURRENT_RECORD_DATE;
    const freeTextSpecialty = 'Cirugía Plástica Ambulatoria';
    const record = buildRecord(date, isoAt(date, '08:00:00'));
    record.cma = [
      {
        id: 'cma-custom-specialty',
        bedName: 'R1',
        patientName: 'Paciente Especialidad Libre',
        rut: '11.111.111-1',
        age: '52a',
        diagnosis: 'Procedimiento ambulatorio',
        specialty: freeTextSpecialty,
        interventionType: 'Cirugía Mayor Ambulatoria',
        dischargeTime: '12:30',
        originalBedId: 'R1',
        originalData: buildPatient('R1', freeTextSpecialty),
      },
    ];

    await expect(saveRecordToFirestore(record)).resolves.toBeUndefined();

    const persisted = await getRecordFromFirestore(date);
    expect(persisted?.cma).toHaveLength(1);
    expect(persisted?.cma[0]).toMatchObject({
      id: 'cma-custom-specialty',
      patientName: 'Paciente Especialidad Libre',
      specialty: freeTextSpecialty,
      originalData: expect.objectContaining({
        specialty: freeTextSpecialty,
      }),
    });
  });
});
