import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  buildPatient,
  buildRecord,
} from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';
import { buildAtomicPatientMovementPatch } from '@/application/census/atomicPatientMovementPatchController';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
}));
vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn(),
  adoptAuthoritativeDailyRecordAtomically: vi.fn(async (record: DailyRecord) => ({
    status: 'adopted',
    record,
  })),
  isRetryableSyncError: vi.fn(),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn(),
  releaseDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
  renewDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));
vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: vi.fn((record: DailyRecord) => ({ record, patches: {} })),
}));
vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: vi.fn((record: DailyRecord) => record),
}));
vi.mock('@/services/utils/fhirMappers', () => ({
  mapPatientToFhir: vi.fn(() => ({})),
}));
vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: {
    upsertPatient: vi.fn().mockResolvedValue(undefined),
  },
}));
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  getRecordForDate as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import {
  ackDailyRecordSyncTask,
  adoptAuthoritativeDailyRecordAtomically,
  queueDailyRecordSyncTaskWithLocalRecord as queueSyncTask,
} from '@/services/storage/sync';
const expectSyncContract = (expectedVersion: string, changedPaths: string[]) =>
  expect.objectContaining({
    syncContract: expect.objectContaining({
      expectedVersion,
      changedPaths,
      recordRevision: expect.any(String),
    }),
  });
describe('dailyRecordRepositoryWriteService explicit base records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queueSyncTask).mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
    vi.mocked(ackDailyRecordSyncTask).mockResolvedValue(true);
  });

  it('uses an explicitly hydrated base record when local cache is missing', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T09:30:00.000Z';
    hydratedBase.beds = {
      R2: buildPatient('R2', 'Paciente Hidratado'),
    };
    const result = await updatePartialDetailed(
      '2026-02-18',
      {
        'beds.R2.patientName': 'Paciente Nuevo',
      },
      { baseRecord: hydratedBase }
    );
    expect(result.outcome).toBe('clean');
    expect(getRecordFromIndexedDB).not.toHaveBeenCalled();
    expect(getRecordFromFirestore).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        'beds.R2.patientName': 'Paciente Nuevo',
      }),
      '2026-02-18T09:30:00.000Z',
      expectSyncContract('2026-02-18T09:30:00.000Z', ['beds.R2.patientName'])
    );
  });
  it('persists clinical fields and device removals from a visible base when local cache is missing', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T09:45:00.000Z';
    hydratedBase.beds = {
      H5C2: {
        ...buildPatient('H5C2', 'Paciente con cambios clinicos'),
        devices: ['VVP#1', 'Sonda Foley'],
      },
    };
    const result = await updatePartialDetailed(
      '2026-02-18',
      {
        'beds.H5C2.pathology': 'Diagnostico actualizado',
        'beds.H5C2.specialty': Specialty.CIRUGIA,
        'beds.H5C2.status': PatientStatus.GRAVE,
        'beds.H5C2.devices': [],
      },
      { baseRecord: hydratedBase }
    );
    expect(result.outcome).toBe('clean');
    expect(getRecordFromIndexedDB).not.toHaveBeenCalled();
    expect(getRecordFromFirestore).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        'beds.H5C2.pathology': 'Diagnostico actualizado',
        'beds.H5C2.specialty': Specialty.CIRUGIA,
        'beds.H5C2.status': PatientStatus.GRAVE,
        'beds.H5C2.devices': [],
      }),
      '2026-02-18T09:45:00.000Z',
      expectSyncContract('2026-02-18T09:45:00.000Z', [
        'beds.H5C2.pathology',
        'beds.H5C2.specialty',
        'beds.H5C2.status',
        'beds.H5C2.devices',
      ])
    );
  });
  it('persists venous access device edits from a visible base when local cache is missing', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T09:40:00.000Z';
    hydratedBase.beds = {
      H5C2: buildPatient('H5C2', 'Paciente con via'),
    };

    const result = await updatePartialDetailed(
      '2026-02-18',
      {
        'beds.H5C2.devices': ['VVP#1'],
      },
      { baseRecord: hydratedBase }
    );

    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        'beds.H5C2.devices': ['VVP#1'],
      }),
      '2026-02-18T09:40:00.000Z',
      expectSyncContract('2026-02-18T09:40:00.000Z', ['beds.H5C2.devices'])
    );
  });

  it('persists a discharge movement from a visible base when local cache is missing', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T09:50:00.000Z';
    hydratedBase.beds = {
      NEO2: buildPatient('NEO2', 'Paciente de alta'),
    };
    const updatedRecord: DailyRecord = {
      ...hydratedBase,
      beds: {
        ...hydratedBase.beds,
        NEO2: createEmptyPatient('NEO2'),
      },
      discharges: [
        {
          id: 'discharge-neo2',
          bedId: 'NEO2',
          bedName: 'NEO 2',
          bedType: 'Cama',
          patientName: 'Paciente de alta',
          rut: '11.111.111-1',
          diagnosis: 'Diagnostico',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
          time: '11:30',
        },
      ],
    };
    const patch = buildAtomicPatientMovementPatch({
      updatedRecord,
      movementKey: 'discharges',
      sourceBedIds: ['NEO2'],
    });
    const result = await updatePartialDetailed('2026-02-18', patch, {
      baseRecord: hydratedBase,
    });
    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        discharges: expect.arrayContaining([
          expect.objectContaining({ id: 'discharge-neo2', bedId: 'NEO2' }),
        ]),
        'beds.NEO2': expect.objectContaining({
          patientName: '',
          rut: '',
          pathology: '',
          specialty: Specialty.EMPTY,
          status: PatientStatus.EMPTY,
          devices: [],
          handoffNoteDayShift: '',
          medicalHandoffEntries: [],
          clinicalCrib: undefined,
        }),
      }),
      '2026-02-18T09:50:00.000Z',
      expectSyncContract('2026-02-18T09:50:00.000Z', ['discharges', 'beds.NEO2'])
    );
  });

  it('persists transfer movement patches and leaves the source bed available from a visible base', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T10:00:00.000Z';
    hydratedBase.beds = {
      NEO2: buildPatient('NEO2', 'Paciente traslado'),
    };
    const clearedNeo2 = createEmptyPatient('NEO2');
    const updatedRecord: DailyRecord = {
      ...hydratedBase,
      beds: {
        ...hydratedBase.beds,
        NEO2: clearedNeo2,
      },
      transfers: [
        {
          id: 'transfer-neo2',
          bedId: 'NEO2',
          bedName: 'NEO 2',
          bedType: 'Cama',
          patientName: 'Paciente traslado',
          rut: '11.111.111-1',
          diagnosis: 'Diagnostico',
          time: '12:00',
          evacuationMethod: 'Ambulancia',
          receivingCenter: 'Hospital Base',
        },
      ],
    };
    const patch = buildAtomicPatientMovementPatch({
      updatedRecord,
      movementKey: 'transfers',
      sourceBedIds: ['NEO2'],
    });

    const result = await updatePartialDetailed('2026-02-18', patch, {
      baseRecord: hydratedBase,
    });

    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        transfers: expect.arrayContaining([
          expect.objectContaining({ id: 'transfer-neo2', bedId: 'NEO2' }),
        ]),
        'beds.NEO2': expect.objectContaining({
          patientName: '',
          rut: '',
          pathology: '',
          specialty: Specialty.EMPTY,
          status: PatientStatus.EMPTY,
          devices: [],
          handoffNoteDayShift: '',
          medicalHandoffEntries: [],
          clinicalCrib: undefined,
        }),
      }),
      '2026-02-18T10:00:00.000Z',
      expectSyncContract('2026-02-18T10:00:00.000Z', ['transfers', 'beds.NEO2'])
    );
  });
  it('persists CMA movement patches and leaves the source bed available from a visible base', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T10:10:00.000Z';
    hydratedBase.beds = {
      NEO1: buildPatient('NEO1', 'Paciente CMA'),
    };
    const clearedNeo1 = createEmptyPatient('NEO1');
    const updatedRecord: DailyRecord = {
      ...hydratedBase,
      beds: {
        ...hydratedBase.beds,
        NEO1: clearedNeo1,
      },
      cma: [
        {
          id: 'cma-neo1',
          bedName: 'NEO 1',
          originalBedId: 'NEO1',
          patientName: 'Paciente CMA',
          rut: '11.111.111-1',
          age: '40a',
          diagnosis: 'Procedimiento',
          specialty: 'Cirugia',
          interventionType: 'Cirugía Mayor Ambulatoria',
        },
      ],
    };
    const patch = buildAtomicPatientMovementPatch({
      updatedRecord,
      movementKey: 'cma',
      sourceBedIds: ['NEO1'],
    });
    const result = await updatePartialDetailed('2026-02-18', patch, {
      baseRecord: hydratedBase,
    });
    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        cma: expect.arrayContaining([
          expect.objectContaining({ id: 'cma-neo1', originalBedId: 'NEO1' }),
        ]),
        'beds.NEO1': expect.objectContaining({
          patientName: '',
          rut: '',
          pathology: '',
          specialty: Specialty.EMPTY,
          status: PatientStatus.EMPTY,
          devices: [],
          handoffNoteNightShift: '',
          medicalHandoffEntries: [],
          clinicalCrib: undefined,
        }),
      }),
      '2026-02-18T10:10:00.000Z',
      expectSyncContract('2026-02-18T10:10:00.000Z', ['cma', 'beds.NEO1'])
    );
  });
  it('marks a movement reclassification for transactional CAS persistence', async () => {
    const hydratedBase = buildRecord('2026-02-18');
    hydratedBase.lastUpdated = '2026-02-18T10:20:00.000Z';
    hydratedBase.discharges = [
      {
        id: 'discharge-1',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente reclasificado',
        rut: '11.111.111-1',
        diagnosis: 'Diagnostico',
        status: 'Vivo',
        dischargeType: 'Domicilio (Habitual)',
        time: '10:15',
      },
    ];
    const confirmedRecord = { ...hydratedBase, lastUpdated: '2026-02-18T10:21:00.000Z' };
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(confirmedRecord);
    const result = await updatePartialDetailed(
      '2026-02-18',
      {
        discharges: [
          {
            ...hydratedBase.discharges[0],
            deletedAt: '2026-02-18T10:20:01.000Z',
            deletedReason: 'converted_to_cma',
          },
        ],
        cma: [
          {
            id: 'reclassified:discharge-1:cma',
            bedName: 'R1',
            originalBedId: 'R1',
            patientName: 'Paciente reclasificado',
            rut: '11.111.111-1',
            age: '40a',
            diagnosis: 'Diagnostico',
            specialty: 'Cirugia',
            interventionType: 'Cirugía Mayor Ambulatoria',
            movementProvenance: {
              source: 'reclassified',
              lineageId: 'discharge-1',
              classifiedAt: '2026-02-18T10:20:01.000Z',
              previousMovementId: 'discharge-1',
              previousClassification: 'discharge',
            },
          },
        ],
      },
      {
        baseRecord: hydratedBase,
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
      }
    );
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-18',
      expect.objectContaining({
        discharges: expect.any(Array),
        cma: expect.any(Array),
      }),
      '2026-02-18T10:20:00.000Z',
      expect.objectContaining({
        requireAtomicCas: true,
        syncContract: expect.objectContaining({
          changedPaths: ['discharges', 'cma'],
        }),
      })
    );
    expect(result.confirmedRecord).toEqual(confirmedRecord);
    expect(getRecordFromFirestore).toHaveBeenCalledWith('2026-02-18', { source: 'server' });
    expect(adoptAuthoritativeDailyRecordAtomically).toHaveBeenCalledWith(
      confirmedRecord,
      expect.any(Function)
    );
    expect(saveToIndexedDB).not.toHaveBeenCalled();
  });
  it('persists guarded Rayen patches remotely before local cache without queuing a stale retry', async () => {
    const hydratedBase = buildRecord('2026-02-13');
    hydratedBase.lastUpdated = '2026-02-13T08:00:00.000Z';
    hydratedBase.beds = { R1: buildPatient('R1', 'Paciente local') };
    const rayenClinicalWriteGuard = {
      runId: 'rayen-run-guarded',
      importMode: 'preview',
      clinicalBatchMode: 'shadow',
      revision: 7,
      sourceDate: '2026-02-13',
      recordScope: 'run',
    } as const;
    vi.mocked(updateRecordPartialToFirestore).mockResolvedValueOnce({
      success: true,
      date: '2026-02-13',
      mode: 'shadow',
      authorityStatus: 'ok',
      coverage: {
        activePatients: 1,
        canonicalEpisodeIds: 1,
        fallbackEpisodeKeys: 0,
        degenerateFallbackEpisodeKeys: 0,
      },
      violations: [],
      recordState: {
        lastUpdated: '2026-02-13T08:05:00.000Z',
        meta: {
          revision: 2,
          lastMutationId: 'rayen-run-guarded',
          updatedAt: '2026-02-13T08:05:00.000Z',
        },
        record: {
          ...hydratedBase,
          lastUpdated: '2026-02-13T08:05:00.000Z',
          meta: {
            revision: 2,
            lastMutationId: 'rayen-run-guarded',
            updatedAt: '2026-02-13T08:05:00.000Z',
          },
        } as unknown as DailyRecord,
      },
    });
    const result = await updatePartialDetailed(
      '2026-02-13',
      { 'beds.R1.vitalSigns': { heartRate: 72 } },
      { baseRecord: hydratedBase, rayenClinicalWriteGuard }
    );
    expect(result.outcome).toBe('clean');
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-13',
      expect.any(Object),
      hydratedBase.lastUpdated,
      expect.objectContaining({ rayenClinicalWriteGuard })
    );
    expect(vi.mocked(updateRecordPartialToFirestore).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(adoptAuthoritativeDailyRecordAtomically).mock.invocationCallOrder[0]
    );
    expect(adoptAuthoritativeDailyRecordAtomically).toHaveBeenCalledWith(
      expect.objectContaining({ lastUpdated: '2026-02-13T08:05:00.000Z' }),
      expect.any(Function)
    );
    expect(queueSyncTask).not.toHaveBeenCalled();
  });
});
