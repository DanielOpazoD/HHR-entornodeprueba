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
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
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
  getPendingDailyRecordSyncTaskSnapshot: vi.fn().mockResolvedValue(null),
  replacePendingDailyRecordSyncTaskWithLocalRecord: vi.fn().mockResolvedValue(false),
  adoptAuthoritativeDailyRecordAtomically: vi.fn().mockImplementation(async record => ({
    status: 'adopted',
    record,
  })),
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
import {
  updatePartial,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
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

describe('dailyRecordRepositoryWriteService intentional clear authority payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not mix derived parent FHIR patches into a confirmed clinical crib removal', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = {
      R1: {
        ...buildPatient('R1', 'Paciente principal'),
        clinicalCrib: buildPatient('R1', 'RN asociado'),
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce({
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          clinicalCrib: undefined,
        },
      },
    });

    await updatePartialDetailed(
      current.date,
      { 'beds.R1.clinicalCrib': null },
      {
        intentionalBedClear: {
          bedId: 'R1',
          target: 'clinicalCrib',
          confirmedLastUpdated: current.lastUpdated,
          confirmedOccupant: { patientName: 'RN asociado' },
        },
      }
    );

    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      current.date,
      { 'beds.R1.clinicalCrib': null },
      current.lastUpdated,
      expect.objectContaining({
        intentionalBedClear: expect.objectContaining({ target: 'clinicalCrib' }),
      })
    );
  });
  it('sends only the semantic clinical crib creation patch to remote authority', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = { R1: buildPatient('R1', 'Paciente principal') };
    const newCrib = {
      ...buildPatient('R1', 'RN de Paciente principal'),
      bedMode: 'Cuna' as const,
      rut: '',
    };
    const confirmedRecord: DailyRecord = {
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          hasCompanionCrib: false,
          clinicalCrib: newCrib,
        },
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(confirmedRecord);
    await updatePartialDetailed(
      current.date,
      {
        'beds.R1.clinicalCrib': newCrib,
        'beds.R1.hasCompanionCrib': false,
      },
      {
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
        requireAtomicCas: true,
        clinicalCribCreate: {
          bedId: 'R1',
          confirmedLastUpdated: current.lastUpdated,
          confirmedParent: { patientName: 'Paciente principal' },
        },
      }
    );
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      current.date,
      expect.objectContaining({
        'beds.R1.clinicalCrib.patientName': newCrib.patientName,
        'beds.R1.clinicalCrib.bedMode': 'Cuna',
        'beds.R1.hasCompanionCrib': false,
      }),
      current.lastUpdated,
      expect.objectContaining({
        requireAtomicCas: true,
        clinicalCribCreate: expect.objectContaining({ bedId: 'R1' }),
      })
    );
    const submittedPatch = vi.mocked(updateRecordPartialToFirestore).mock.calls[0]?.[1] ?? {};
    expect(Object.keys(submittedPatch)).not.toContain('beds.R1.clinicalCrib.devices');
  });
  it('adopts an identical remote crib when the successful create response was lost', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = { R1: buildPatient('R1', 'Paciente principal') };
    const newCrib = {
      ...buildPatient('R1', 'RN de Paciente principal'),
      bedMode: 'Cuna' as const,
      identityStatus: 'provisional' as const,
      rut: '',
    };
    const authoritativeRecord: DailyRecord = {
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          clinicalCrib: newCrib,
        },
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce({
      code: 'functions/deadline-exceeded',
      message: 'response lost after commit',
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(authoritativeRecord);
    const result = await updatePartialDetailed(
      current.date,
      { 'beds.R1.clinicalCrib': newCrib },
      {
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
        requireAtomicCas: true,
        clinicalCribCreate: {
          bedId: 'R1',
          confirmedLastUpdated: current.lastUpdated,
          confirmedParent: { patientName: 'Paciente principal' },
        },
      }
    );
    expect(result).toMatchObject({
      outcome: 'clean',
      savedLocally: true,
      updatedRemotely: true,
      confirmedRecord: authoritativeRecord,
      observabilityTags: expect.arrayContaining(['already_applied']),
    });
    expect(result.localProjectionRecord?.beds.R1.clinicalCrib?.patientName).toBe(
      'RN de Paciente principal'
    );
  });
  it('does not adopt a remote crib when a sibling creation field differs', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = { R1: buildPatient('R1', 'Paciente principal') };
    const newCrib = {
      ...buildPatient('R1', 'RN de Paciente principal'),
      bedMode: 'Cuna' as const,
      identityStatus: 'provisional' as const,
      rut: '',
    };
    const replacementRecord: DailyRecord = {
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...current.beds.R1,
          hasCompanionCrib: true,
          clinicalCrib: newCrib,
        },
      },
    };
    const rejection = new ConcurrencyError('remote changed');
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(rejection);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(replacementRecord);
    await expect(
      updatePartialDetailed(
        current.date,
        {
          'beds.R1.clinicalCrib': newCrib,
          'beds.R1.hasCompanionCrib': false,
        },
        {
          requireConfirmedRecord: true,
          requireRemoteAuthorityFirst: true,
          requireAtomicCas: true,
          clinicalCribCreate: {
            bedId: 'R1',
            confirmedLastUpdated: current.lastUpdated,
            confirmedParent: { patientName: 'Paciente principal' },
          },
        }
      )
    ).rejects.toBe(rejection);
    expect(saveToIndexedDB).not.toHaveBeenCalledWith(replacementRecord);
  });

  it('removes a local ghost when Firestore already has no associated crib', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = {
      R1: {
        ...buildPatient('R1', 'Paciente principal'),
        clinicalCrib: buildPatient('R1', 'RN asociado'),
      },
    };
    const authoritativeRecord = {
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...buildPatient('R1', 'Paciente principal'),
          clinicalCrib: undefined,
        },
      },
    };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(
      new ConcurrencyError('remote changed')
    );
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(authoritativeRecord);

    const result = await updatePartialDetailed(
      current.date,
      { 'beds.R1.clinicalCrib': null },
      {
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
        intentionalBedClear: {
          bedId: 'R1',
          target: 'clinicalCrib',
          confirmedLastUpdated: current.lastUpdated,
          confirmedOccupant: { patientName: 'RN asociado' },
        },
      }
    );

    expect(result).toMatchObject({
      outcome: 'clean',
      savedLocally: true,
      updatedRemotely: true,
      confirmedRecord: authoritativeRecord,
      observabilityTags: expect.arrayContaining(['already_applied']),
    });
    expect(result.localProjectionRecord?.beds.R1.clinicalCrib).toBeUndefined();
    expect(getRecordFromFirestore).toHaveBeenCalledWith(current.date, { source: 'server' });
  });

  it('keeps blocking when Firestore contains a replacement crib', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = {
      R1: {
        ...buildPatient('R1', 'Paciente principal'),
        clinicalCrib: buildPatient('R1', 'RN confirmado'),
      },
    };
    const replacementRecord = {
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...buildPatient('R1', 'Paciente principal'),
          clinicalCrib: buildPatient('R1', 'RN reemplazante'),
        },
      },
    } as DailyRecord;
    const rejection = new ConcurrencyError('remote changed');
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(rejection);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(replacementRecord);

    await expect(
      updatePartialDetailed(
        current.date,
        { 'beds.R1.clinicalCrib': null },
        {
          requireConfirmedRecord: true,
          requireRemoteAuthorityFirst: true,
          intentionalBedClear: {
            bedId: 'R1',
            target: 'clinicalCrib',
            confirmedLastUpdated: current.lastUpdated,
            confirmedOccupant: { patientName: 'RN confirmado' },
          },
        }
      )
    ).rejects.toBe(rejection);

    expect(saveToIndexedDB).not.toHaveBeenCalledWith(replacementRecord);
  });

  it('does not adopt a superficially empty bed that still contains clinical state', async () => {
    const current = buildRecord('2026-08-29');
    current.beds = { R1: buildPatient('R1', 'Paciente confirmado') };
    const clearedPatient: PatientData = {
      ...buildPatient('R1', ''),
      rut: '',
      pathology: '',
      admissionDate: '',
      clinicalEpisodeId: undefined,
      devices: [],
    };
    const residualRecord: DailyRecord = {
      ...current,
      lastUpdated: '2026-08-29T00:00:05.000Z',
      beds: {
        R1: {
          ...clearedPatient,
          clinicalEpisodeId: 'episodio-aun-vigente',
          devices: ['CVC'],
        },
      },
    };
    const rejection = new ConcurrencyError('remote changed');
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(current);
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(rejection);
    vi.mocked(getRecordFromFirestore).mockResolvedValueOnce(residualRecord);

    await expect(
      updatePartialDetailed(
        current.date,
        { 'beds.R1': clearedPatient },
        {
          requireConfirmedRecord: true,
          requireRemoteAuthorityFirst: true,
          intentionalBedClear: {
            bedId: 'R1',
            target: 'bed',
            confirmedLastUpdated: current.lastUpdated,
            confirmedOccupant: { patientName: 'Paciente confirmado' },
          },
        }
      )
    ).rejects.toBe(rejection);

    expect(saveToIndexedDB).not.toHaveBeenCalledWith(residualRecord);
  });
});
