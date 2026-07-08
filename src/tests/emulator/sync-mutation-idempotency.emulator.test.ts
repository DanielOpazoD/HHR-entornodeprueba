/* @flake-safe: Date usage aligns emulator write-window assertions with current execution time. */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';

const { mockAuthorityCallable } = vi.hoisted(() => ({
  mockAuthorityCallable: vi.fn(),
}));

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

vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: (...args: unknown[]) =>
    mockAuthorityCallable(...args),
}));

import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { clearAllRecords, saveRecord } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  clearAllSyncQueue,
  getSyncQueueStats,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
} from '@/services/storage/sync';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';

const CURRENT_RECORD_DATE = new Date().toISOString().slice(0, 10);
const isoAt = (date: string, time: string): string => `${date}T${time}.000Z`;

const buildRecord = (date: string, lastUpdated: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated,
  nurses: [],
  activeExtraBeds: [],
  dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
});

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Idempotente',
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
});

const buildEmptyBed = (bedId: string): PatientData =>
  buildPatient(bedId, {
    patientName: '',
    rut: '',
    pathology: '',
    admissionDate: '',
    clinicalEpisodeId: '',
  });

describeEmulator('Firestore emulator mutation idempotency', () => {
  let testEnv: RulesTestEnvironment;
  let nurseDb: TestFirestore;

  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);

    testEnv = await initializeTestEnvironment({
      projectId: 'demo-hhr-sync-mutation-idempotency-test',
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
    mockAuthorityCallable.mockReset();
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    setFirestoreEnabled(true);
    activeDb = nurseDb;
  });

  afterAll(async () => {
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    await testEnv.cleanup();
  });

  it('drains an already-applied mutationId without calling the enforced authority callable', async () => {
    const date = CURRENT_RECORD_DATE;
    const mutationId = 'mutation-emulator-already-applied';
    const localRecord = buildRecord(date, isoAt(date, '10:00:00'));
    localRecord.beds = {
      R1: buildPatient('R1', { pathology: 'Diagnostico local pendiente' }),
    };

    const remoteAlreadyApplied = buildRecord(date, isoAt(date, '10:05:00'));
    remoteAlreadyApplied.beds = {
      R1: buildPatient('R1', { pathology: 'Diagnostico ya aplicado' }),
    };

    await saveRecord(localRecord);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set({
          ...remoteAlreadyApplied,
          meta: {
            revision: 4,
            lastMutationId: mutationId,
            lastChangedPaths: ['beds.R1.pathology'],
          },
        });
    });

    await queueDailyRecordSyncTaskWithLocalRecord(localRecord, {
      contexts: ['clinical'],
      origin: 'direct_queue',
      syncContract: {
        expectedVersion: isoAt(date, '09:55:00'),
        changedPaths: ['beds.R1.pathology'],
        mutationId,
      },
    });

    await processSyncQueue();

    expect(mockAuthorityCallable).not.toHaveBeenCalled();
    await expect(getSyncQueueStats()).resolves.toMatchObject({
      pending: 0,
      failed: 0,
      conflict: 0,
    });
    const remote = await getRecordFromFirestore(date);
    expect(remote?.beds.R1.pathology).toBe('Diagnostico ya aplicado');
  });

  it('enforces the clinical truth contract through stale restarted multi-PC movement replay', async () => {
    const date = CURRENT_RECORD_DATE;
    const mutationId = 'mutation-restarted-movement-outbox';
    const base = buildRecord(date, isoAt(date, '09:55:00'));
    base.beds = {
      R1: buildPatient('R1', {
        patientName: 'Paciente Movimiento Remoto',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'episode-remote-move',
      }),
      R2: buildPatient('R2', {
        patientName: 'Paciente Alta Remota',
        rut: '22.222.222-2',
        clinicalEpisodeId: 'episode-remote-discharge',
      }),
      R3: buildPatient('R3', {
        patientName: 'Paciente Traslado Remoto',
        rut: '33.333.333-3',
        clinicalEpisodeId: 'episode-remote-transfer',
      }),
      R4: buildPatient('R4', {
        patientName: 'Paciente CMA Remoto',
        rut: '44.444.444-4',
        clinicalEpisodeId: 'episode-remote-cma',
      }),
      R5: buildPatient('R5', {
        patientName: 'Paciente Movimiento Local',
        rut: '55.555.555-5',
        clinicalEpisodeId: 'episode-local-move',
      }),
      R6: buildPatient('R6', {
        patientName: 'Paciente Alta Local',
        rut: '66.666.666-6',
        clinicalEpisodeId: 'episode-local-discharge',
      }),
      R7: buildPatient('R7', {
        patientName: 'Paciente Traslado Local',
        rut: '77.777.777-7',
        clinicalEpisodeId: 'episode-local-transfer',
      }),
      R8: buildPatient('R8', {
        patientName: 'Paciente CMA Local',
        rut: '88.888.888-8',
        clinicalEpisodeId: 'episode-local-cma',
      }),
      R9: buildEmptyBed('R9'),
      R10: buildEmptyBed('R10'),
    };

    const remoteAfterClientA = {
      ...base,
      lastUpdated: isoAt(date, '10:10:00'),
      beds: {
        ...base.beds,
        R1: buildEmptyBed('R1'),
        R2: buildEmptyBed('R2'),
        R3: buildEmptyBed('R3'),
        R4: buildEmptyBed('R4'),
        R9: {
          ...base.beds.R1,
          bedId: 'R9',
        },
      },
      discharges: [
        {
          id: 'discharge-remote-a',
          bedId: 'R2',
          patientName: 'Paciente Alta Remota',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'episode-remote-discharge',
          diagnosis: 'Alta remota conservada',
        },
      ],
      transfers: [
        {
          id: 'transfer-remote-a',
          bedId: 'R3',
          patientName: 'Paciente Traslado Remoto',
          rut: '33.333.333-3',
          clinicalEpisodeId: 'episode-remote-transfer',
          diagnosis: 'Traslado remoto conservado',
        },
      ],
      cma: [
        {
          id: 'cma-remote-a',
          bedName: 'R4',
          originalBedId: 'R4',
          patientName: 'Paciente CMA Remoto',
          rut: '44.444.444-4',
          clinicalEpisodeId: 'episode-remote-cma',
          diagnosis: 'CMA remoto conservado',
        },
      ],
    } as unknown as DailyRecord;

    const localStaleAfterRestart = {
      ...base,
      lastUpdated: isoAt(date, '10:00:00'),
      beds: {
        ...base.beds,
        R5: buildEmptyBed('R5'),
        R6: buildEmptyBed('R6'),
        R7: buildEmptyBed('R7'),
        R8: buildEmptyBed('R8'),
        R10: {
          ...base.beds.R5,
          bedId: 'R10',
        },
      },
      discharges: [
        {
          id: 'discharge-local-b',
          bedId: 'R6',
          patientName: 'Paciente Alta Local',
          rut: '66.666.666-6',
          clinicalEpisodeId: 'episode-local-discharge',
          diagnosis: 'Alta local conservada tras reinicio',
        },
      ],
      transfers: [
        {
          id: 'transfer-local-b',
          bedId: 'R7',
          patientName: 'Paciente Traslado Local',
          rut: '77.777.777-7',
          clinicalEpisodeId: 'episode-local-transfer',
          diagnosis: 'Traslado local conservado tras reinicio',
        },
      ],
      cma: [
        {
          id: 'cma-local-b',
          bedName: 'R8',
          originalBedId: 'R8',
          patientName: 'Paciente CMA Local',
          rut: '88.888.888-8',
          clinicalEpisodeId: 'episode-local-cma',
          diagnosis: 'CMA local conservado tras reinicio',
        },
      ],
    } as unknown as DailyRecord;

    await saveRecord(localStaleAfterRestart);
    await testEnv.withSecurityRulesDisabled(async context => {
      await context
        .firestore()
        .doc(`hospitals/hanga_roa/dailyRecords/${date}`)
        .set({
          ...remoteAfterClientA,
          meta: {
            revision: 8,
            lastMutationId: 'mutation-client-a',
            lastChangedPaths: [
              'beds.R1',
              'beds.R2',
              'beds.R3',
              'beds.R4',
              'beds.R9',
              'discharges',
              'transfers',
              'cma',
            ],
          },
        });
    });

    await queueDailyRecordSyncTaskWithLocalRecord(
      localStaleAfterRestart,
      {
        contexts: ['movements', 'clinical'],
        origin: 'direct_queue',
        syncContract: {
          expectedVersion: base.lastUpdated,
          baseRevision: 7,
          changedPaths: [
            'beds.R5',
            'beds.R6',
            'beds.R7',
            'beds.R8',
            'beds.R10',
            'discharges',
            'transfers',
            'cma',
          ],
          mutationId,
          clientId: 'client-b',
          tabId: 'tab-before-restart',
        },
      },
      { deferProcessing: true }
    );

    await expect(getSyncQueueStats()).resolves.toMatchObject({
      pending: 1,
      failed: 0,
      conflict: 0,
    });

    resetSyncMutationIdentityForTests();
    await processSyncQueue();

    expect(mockAuthorityCallable).toHaveBeenCalledTimes(1);
    const authorityPayload = mockAuthorityCallable.mock.calls[0]?.[0] as {
      record: DailyRecord;
      mode: string;
      expectedLastUpdated?: string;
    };
    expect(authorityPayload).toMatchObject({
      mode: 'enforced',
      expectedLastUpdated: base.lastUpdated,
    });
    expect(authorityPayload.record.discharges.map(item => item.id)).toEqual([
      'discharge-remote-a',
      'discharge-local-b',
    ]);
    expect(authorityPayload.record.transfers.map(item => item.id)).toEqual([
      'transfer-remote-a',
      'transfer-local-b',
    ]);
    expect(authorityPayload.record.cma.map(item => item.id)).toEqual([
      'cma-remote-a',
      'cma-local-b',
    ]);
    expect(authorityPayload.record.beds.R9?.patientName).toBe('Paciente Movimiento Remoto');
    expect(authorityPayload.record.beds.R10?.patientName).toBe('Paciente Movimiento Local');
    expect(authorityPayload.record.beds.R1?.patientName).toBe('');
    expect(authorityPayload.record.beds.R5?.patientName).toBe('');
    await expect(getSyncQueueStats()).resolves.toMatchObject({
      pending: 0,
      failed: 0,
      conflict: 0,
    });
  });
});
