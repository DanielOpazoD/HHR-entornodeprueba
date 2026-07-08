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

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
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

import { updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';

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

describe('dailyRecordRepositoryWriteService specialist handoff patches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not append fhir patches for specialist-scoped medical handoff updates', async () => {
    const current = buildRecord('2026-02-11');
    current.beds = { R1: buildPatient('R1', 'Paciente local') };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    await updatePartial('2026-02-11', {
      'beds.R1.medicalHandoffNote': 'Evolución especialista',
      'beds.R1.medicalHandoffEntries': [
        {
          id: 'entry-1',
          specialty: 'Med Interna',
          note: 'Evolución especialista',
        },
      ] as never,
    });

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-11',
      expect.not.objectContaining({
        'beds.R1.fhir_resource': expect.anything(),
      }),
      current.lastUpdated,
      expect.objectContaining({
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.medicalHandoffNote', 'beds.R1.medicalHandoffEntries'],
          expectedVersion: current.lastUpdated,
        }),
      })
    );
  });

  it('does not append structural bed normalization patches for specialist-scoped medical handoff updates', async () => {
    const current = buildRecord('2026-02-11');
    current.beds = { R1: buildPatient('R1', 'Paciente local') };

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);

    await updatePartial('2026-02-11', {
      'beds.R1.medicalHandoffNote': 'Evolución especialista',
      'beds.R1.medicalHandoffEntries': [
        {
          id: 'entry-1',
          specialty: 'Med Interna',
          note: 'Evolución especialista',
        },
      ] as never,
    });

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      '2026-02-11',
      expect.not.objectContaining({
        'beds.R2': expect.anything(),
        'beds.NEO1': expect.anything(),
      }),
      current.lastUpdated,
      expect.objectContaining({
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.medicalHandoffNote', 'beds.R1.medicalHandoffEntries'],
          expectedVersion: current.lastUpdated,
        }),
      })
    );
  });
});
