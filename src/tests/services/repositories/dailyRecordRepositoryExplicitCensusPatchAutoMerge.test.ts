import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
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
  ackDailyRecordSyncTask: vi.fn().mockResolvedValue(true),
  isRetryableSyncError: vi.fn(),
  queueSyncTask: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
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

vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictAutoMerged: vi.fn().mockResolvedValue(undefined),
}));

import {
  updatePartial,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { queueDailyRecordSyncTaskWithLocalRecord as queueSyncTask } from '@/services/storage/sync';

const buildRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T00:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
});

const buildPatient = (bedId: string, patientName: string): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName,
  rut: '11.111.111-1',
  age: '40a',
  pathology: 'Diagnostico',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-18',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
});

describe('dailyRecordRepositoryWriteService explicit census patch auto-merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queueSyncTask).mockResolvedValue({
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 192,
    });
  });

  it('keeps explicit local specialty and status edits during partial-update auto-merge', async () => {
    const current = buildRecord('2026-02-15');
    current.beds = { R1: buildPatient('R1', 'Paciente vigente') };
    current.beds.R1.clinicalEpisodeId = 'episode-r1';
    current.beds.R1.specialty = 'Otra especialidad';
    current.beds.R1.secondarySpecialty = 'Infectologia';
    current.beds.R1.status = PatientStatus.GRAVE;

    const remote = buildRecord('2026-02-15');
    remote.beds = { R1: buildPatient('R1', 'Paciente vigente') };
    remote.beds.R1.clinicalEpisodeId = 'episode-r1';
    remote.beds.R1.specialty = Specialty.MEDICINA;
    remote.beds.R1.secondarySpecialty = Specialty.CIRUGIA;
    remote.beds.R1.status = PatientStatus.ESTABLE;
    remote.beds.R1.pathology = 'Diagnostico remoto concurrente';

    const concurrencyError = new Error('Concurrency conflict');
    concurrencyError.name = 'ConcurrencyError';

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(concurrencyError);
    vi.mocked(getRecordFromFirestore).mockResolvedValue(remote);

    await expect(
      updatePartial('2026-02-15', {
        'beds.R1.specialty': 'Otra especialidad',
        'beds.R1.secondarySpecialty': 'Infectologia',
        'beds.R1.status': PatientStatus.GRAVE,
      })
    ).resolves.toBeUndefined();

    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-02-15',
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            specialty: 'Otra especialidad',
            secondarySpecialty: 'Infectologia',
            status: PatientStatus.GRAVE,
            pathology: 'Diagnostico remoto concurrente',
          }),
        }),
      }),
      expect.objectContaining({
        contexts: ['clinical'],
        origin: 'conflict_auto_merge',
      })
    );
  });

  it('auto-merges concurrent diagnosis, free-text specialty and status patches with an exact sync contract', async () => {
    const current = buildRecord('2026-02-15');
    current.lastUpdated = '2026-02-15T10:00:00.000Z';
    current.beds = { R1: buildPatient('R1', 'Paciente vigente') };
    current.beds.R1.clinicalEpisodeId = 'episode-r1';
    current.beds.R1.rut = '11.111.111-1';
    current.beds.R1.admissionDate = '2026-02-14';
    current.beds.R1.admissionTime = '08:30';
    current.beds.R1.specialty = 'Otra especialidad libre';
    current.beds.R1.secondarySpecialty = 'Dermatologia oncológica';
    current.beds.R1.status = PatientStatus.DE_CUIDADO;
    current.beds.R1.pathology = 'Diagnostico local editado';

    const remote = buildRecord('2026-02-15');
    remote.lastUpdated = '2026-02-15T10:05:00.000Z';
    remote.beds = { R1: buildPatient('R1', 'Paciente vigente') };
    remote.beds.R1.clinicalEpisodeId = 'episode-r1';
    remote.beds.R1.rut = '11.111.111-1';
    remote.beds.R1.admissionDate = '2026-02-14';
    remote.beds.R1.admissionTime = '08:30';
    remote.beds.R1.specialty = Specialty.MEDICINA;
    remote.beds.R1.secondarySpecialty = '';
    remote.beds.R1.status = PatientStatus.ESTABLE;
    remote.beds.R1.pathology = 'Diagnostico remoto concurrente no relacionado';

    const concurrencyError = new Error('Concurrency conflict');
    concurrencyError.name = 'ConcurrencyError';

    const patch = {
      'beds.R1.pathology': 'Diagnostico local editado',
      'beds.R1.specialty': 'Otra especialidad libre',
      'beds.R1.secondarySpecialty': 'Dermatologia oncológica',
      'beds.R1.status': PatientStatus.DE_CUIDADO,
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(concurrencyError);
    vi.mocked(getRecordFromFirestore).mockResolvedValue(remote);

    await expect(updatePartialDetailed('2026-02-15', patch)).resolves.toMatchObject({
      outcome: 'auto_merged',
      autoMerged: true,
      queuedForRetry: true,
      patchedFields: 6,
      conflictSummary: expect.objectContaining({
        changedPaths: Object.keys(patch),
      }),
    });

    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-02-15',
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            specialty: 'Otra especialidad libre',
            secondarySpecialty: 'Dermatologia oncológica',
            status: PatientStatus.DE_CUIDADO,
            pathology: 'Diagnostico local editado',
          }),
        }),
      }),
      expect.objectContaining({
        contexts: ['clinical'],
        origin: 'conflict_auto_merge',
        syncContract: expect.objectContaining({
          expectedVersion: '2026-02-15T10:05:00.000Z',
          changedPaths: Object.keys(patch),
        }),
      })
    );
  });

  it('auto-merges a new-patient status patch when only the remote side has the generated episode id', async () => {
    const current = buildRecord('2026-02-15');
    current.lastUpdated = '2026-02-15T10:00:00.000Z';
    current.beds = { R1: buildPatient('R1', 'Paciente recien ingresado') };
    current.beds.R1.clinicalEpisodeId = undefined;
    current.beds.R1.rut = '11.111.111-1';
    current.beds.R1.admissionDate = '2026-02-15';
    current.beds.R1.admissionTime = '08:30';
    current.beds.R1.status = PatientStatus.GRAVE;

    const remote = buildRecord('2026-02-15');
    remote.lastUpdated = '2026-02-15T10:05:00.000Z';
    remote.beds = { R1: buildPatient('R1', 'Paciente recien ingresado') };
    remote.beds.R1.clinicalEpisodeId = 'ep_r1_generated';
    remote.beds.R1.rut = '11.111.111-1';
    remote.beds.R1.admissionDate = '2026-02-15';
    remote.beds.R1.admissionTime = '08:30';
    remote.beds.R1.status = PatientStatus.EMPTY;

    const concurrencyError = new Error('Concurrency conflict');
    concurrencyError.name = 'ConcurrencyError';

    const patch = {
      'beds.R1.status': PatientStatus.GRAVE,
    };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(concurrencyError);
    vi.mocked(getRecordFromFirestore).mockResolvedValue(remote);

    await expect(updatePartialDetailed('2026-02-15', patch)).resolves.toMatchObject({
      outcome: 'auto_merged',
      autoMerged: true,
      queuedForRetry: true,
      conflictSummary: expect.objectContaining({
        changedPaths: Object.keys(patch),
      }),
    });

    expect(queueSyncTask).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-02-15',
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            clinicalEpisodeId: 'ep_r1_generated',
            status: PatientStatus.GRAVE,
          }),
        }),
      }),
      expect.objectContaining({
        contexts: ['clinical'],
        origin: 'conflict_auto_merge',
      })
    );
  });
});
