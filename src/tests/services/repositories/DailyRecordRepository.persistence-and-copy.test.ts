import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import {
  buildCudyr,
  buildPatient,
  firestoreMock,
  indexedDbFacadeMock,
  logErrorMock,
  mockDate,
  mockRecord,
  Repository,
  resetDailyRecordRepositoryLifecycleState,
} from '@/tests/services/repositories/DailyRecordRepository.lifecycle-support';

describe('DailyRecordRepository persistence and copy flows', () => {
  beforeEach(() => {
    resetDailyRecordRepositoryLifecycleState();
  });

  it('saves to both local and remote', async () => {
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(null);

    await Repository.save(mockRecord);

    expect(indexedDbFacadeMock.saveRecord).toHaveBeenCalled();
    expect(firestoreMock.saveRecordToFirestore).toHaveBeenCalled();
  });

  it('logs invariant repairs when record is auto-corrected', async () => {
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(null);

    await Repository.save(mockRecord);

    expect(logErrorMock).toHaveBeenCalledWith(
      'Invariant repair applied on save',
      undefined,
      expect.objectContaining({
        date: mockDate,
        patches: expect.any(Array),
      })
    );
  });

  it('blocks save if regression detected', async () => {
    const remoteWithData: DailyRecord = {
      ...mockRecord,
      beds: {},
    };
    for (let i = 0; i < 10; i++) {
      remoteWithData.beds[`BED_${i}`] = buildPatient({ patientName: `Patient ${i}` });
    }

    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(remoteWithData);

    await expect(Repository.save(mockRecord)).rejects.toThrow(
      'Se detectó una pérdida masiva de datos'
    );
  });

  it('updates both local and remote on updatePartial', async () => {
    const patch: DailyRecordPatch = {
      'beds.R1.patientName': 'New Name',
      'beds.R1.rut': '12.345.678-9',
    };
    indexedDbFacadeMock.getRecordForDate.mockResolvedValueOnce(mockRecord);

    await Repository.updatePartial(mockDate, patch);

    expect(indexedDbFacadeMock.getRecordForDate).toHaveBeenCalledWith(mockDate);
    expect(firestoreMock.updateRecordPartial).toHaveBeenCalledWith(
      mockDate,
      expect.anything(),
      mockRecord.lastUpdated,
      expect.objectContaining({
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R1.patientName', 'beds.R1.rut'],
          expectedVersion: mockRecord.lastUpdated,
        }),
      })
    );
  });

  it('deletes from local and moves to trash in remote', async () => {
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(mockRecord);

    await Repository.deleteDay(mockDate);
    expect(indexedDbFacadeMock.deleteRecord).toHaveBeenCalledWith(mockDate);
    expect(firestoreMock.moveRecordToTrash).toHaveBeenCalledWith(mockRecord);
  });

  it('copies patient and resets CUDYR', async () => {
    const sourceDate = '2024-12-30';
    const targetDate = '2024-12-31';
    const recordsByDate = new Map<string, DailyRecord>();
    const sourceRecord = {
      ...mockRecord,
      date: sourceDate,
      beds: {
        R1: buildPatient({
          patientName: 'Patient X',
          cudyr: buildCudyr({ changeClothes: 2 }),
        }),
      },
    };
    recordsByDate.set(sourceDate, sourceRecord);

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date => {
      return recordsByDate.get(date) ?? null;
    });
    indexedDbFacadeMock.saveRecord.mockImplementation(async record => {
      recordsByDate.set(record.date, record);
    });

    await Repository.copyPatientToDate(sourceDate, 'R1', targetDate, 'R2');

    expect(firestoreMock.updateRecordPartial).toHaveBeenCalledWith(
      targetDate,
      expect.objectContaining({
        'beds.R2': expect.objectContaining({
          patientName: 'Patient X',
          cudyr: undefined,
        }),
      }),
      expect.any(String),
      expect.anything()
    );
    expect(indexedDbFacadeMock.saveRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        date: targetDate,
        beds: expect.objectContaining({
          R2: expect.objectContaining({
            patientName: 'Patient X',
            cudyr: undefined,
          }),
        }),
      })
    );
  });

  it('copies a patient to an existing date with a target-bed partial patch', async () => {
    const sourceDate = '2024-12-30';
    const targetDate = '2024-12-31';
    const sourceRecord = {
      ...mockRecord,
      date: sourceDate,
      beds: {
        R1: buildPatient({
          patientName: 'Patient X',
          cudyr: buildCudyr({ changeClothes: 2 }),
        }),
      },
    };
    const targetRecord = {
      ...mockRecord,
      date: targetDate,
      lastUpdated: `${targetDate}T00:00:00.000Z`,
      beds: {
        R2: buildPatient({ bedId: 'R2' }),
      },
    };

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date => {
      if (date === sourceDate) return sourceRecord;
      if (date === targetDate) return targetRecord;
      return null;
    });

    await Repository.copyPatientToDate(sourceDate, 'R1', targetDate, 'R2');

    expect(firestoreMock.updateRecordPartial).toHaveBeenCalledWith(
      targetDate,
      expect.objectContaining({
        'beds.R2': expect.objectContaining({
          bedId: 'R2',
          patientName: 'Patient X',
          cudyr: undefined,
        }),
      }),
      targetRecord.lastUpdated,
      expect.objectContaining({
        syncContract: expect.objectContaining({
          changedPaths: ['beds.R2'],
          expectedVersion: targetRecord.lastUpdated,
        }),
      })
    );
    expect(firestoreMock.saveRecordToFirestore).not.toHaveBeenCalled();
  });

  it('returns copy metadata through copyPatientToDateDetailed', async () => {
    const sourceDate = '2024-12-30';
    const targetDate = '2024-12-31';
    const recordsByDate = new Map<string, DailyRecord>();
    const sourceRecord = {
      ...mockRecord,
      date: sourceDate,
      beds: {
        R1: buildPatient({
          patientName: 'Patient X',
          status: 'ESTADO_INVALIDO',
        } as unknown as Partial<PatientData>),
      },
    };
    recordsByDate.set(sourceDate, sourceRecord);

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date => {
      return recordsByDate.get(date) ?? null;
    });
    indexedDbFacadeMock.saveRecord.mockImplementation(async record => {
      recordsByDate.set(record.date, record);
    });

    const result = await Repository.copyPatientToDateDetailed(sourceDate, 'R1', targetDate, 'R2');

    expect(result.sourceDate).toBe(sourceDate);
    expect(result.outcome).toBe('repaired');
    expect(result.sourceMigrationRulesApplied).toContain('salvage_patient_fallback_applied');
  });

  it('rejects empty bed ids on copyPatientToDate', async () => {
    await expect(
      Repository.copyPatientToDate('2026-02-18', '', '2026-02-19', 'R1')
    ).rejects.toThrow(/non-empty bed id/);
  });
});
