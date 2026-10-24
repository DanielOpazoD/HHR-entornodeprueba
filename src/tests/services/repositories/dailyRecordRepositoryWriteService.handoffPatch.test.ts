import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { buildRecord, buildPatient } from './dailyRecordHandoffPatchTestSupport';
import { shouldRouteSpecialistPatchViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import {
  updatePartial,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import { getRecordForDate as getRecordFromIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { saveRecordStrict as saveToIndexedDB } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';

describe('dailyRecordRepositoryWriteService specialist handoff patches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(false);
  });
  it('binds the edited occupant and rejects turnover without saving or queueing the note', async () => {
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
    const current = buildRecord('2026-02-11');
    current.beds = {
      R1: {
        ...buildPatient('R1', 'Paciente A Sintético'),
        clinicalEpisodeId: 'synthetic-episode-A',
      },
    };
    const conflict = new ConcurrencyError(
      'El episodio de R1 cambió. Recarga.',
      'semantic_conflict'
    );
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(conflict);
    await expect(
      updatePartialDetailed(
        current.date,
        { 'beds.R1.medicalHandoffNote': 'Nota de A' },
        { baseRecord: current }
      )
    ).rejects.toBe(conflict);
    expect(updateRecordPartialToFirestore).toHaveBeenCalledTimes(1);
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      current.date,
      expect.anything(),
      current.lastUpdated,
      expect.objectContaining({
        specialistHandoffTargets: [
          {
            bedId: 'R1',
            target: 'bed',
            clinicalEpisodeId: 'synthetic-episode-A',
            patientName: 'Paciente A Sintético',
            rut: current.beds.R1.rut,
            documentType: 'RUT',
          },
        ],
      })
    );
    expect(saveToIndexedDB).not.toHaveBeenCalled();
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();
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
