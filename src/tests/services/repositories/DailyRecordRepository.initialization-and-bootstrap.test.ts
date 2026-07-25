import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import {
  buildCudyr,
  buildPatient,
  firestoreMock,
  indexedDbFacadeMock,
  legacyFirebaseMock,
  mockDate,
  mockRecord,
  Repository,
  resetDailyRecordRepositoryLifecycleState,
} from '@/tests/services/repositories/DailyRecordRepository.lifecycle-support';

describe('DailyRecordRepository initialization and bootstrap flows', () => {
  beforeEach(() => {
    resetDailyRecordRepositoryLifecycleState();
  });

  it('returns existing record if initializeDay finds one', async () => {
    indexedDbFacadeMock.getRecordForDate.mockResolvedValueOnce(mockRecord);
    const result = await Repository.initializeDay(mockDate);
    expect(result).toMatchObject({
      ...mockRecord,
      beds: expect.any(Object),
    });
  });

  it('creates new record and copies from previous day if available', async () => {
    const prevRecord = {
      ...mockRecord,
      date: '2024-12-31',
      nursesNightShift: ['Nurse A', 'Nurse B'],
      handoffNightReceives: ['Receiver A', 'Receiver B'],
      beds: { R1: buildPatient({ patientName: 'Patient X', admissionDate: '2024-12-30' }) },
    };

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date =>
      date === '2024-12-31' ? prevRecord : null
    );
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(null);

    const result = await Repository.initializeDay(mockDate, '2024-12-31');

    expect(result.date).toBe(mockDate);
    expect(result.nursesDayShift).toEqual(['', '']);
    expect(result.beds.R1.patientName).toBe('Patient X');
  });

  it('returns semantic initialization outcome through initializeDayDetailed', async () => {
    const prevRecord = {
      ...mockRecord,
      date: '2024-12-31',
      beds: {
        R1: buildPatient({
          patientName: 'Paciente legacy',
          status: 'ESTADO_INVALIDO',
        } as unknown as Partial<PatientData>),
      },
    };

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date => {
      if (date === mockDate) return null;
      if (date === '2024-12-31') return prevRecord;
      return null;
    });

    const result = await Repository.initializeDayDetailed(mockDate, '2024-12-31');

    expect(result.outcome).toBe('repaired');
    expect(result.sourceMigrationRulesApplied.length).toBeGreaterThan(0);
  });

  it('falls back to firestore during initialization if not found locally', async () => {
    indexedDbFacadeMock.getRecordForDate.mockResolvedValueOnce(null);
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(mockRecord);

    const result = await Repository.initializeDay(mockDate);
    expect(result).toMatchObject({
      ...mockRecord,
      beds: expect.any(Object),
    });
    expect(indexedDbFacadeMock.saveRecord).toHaveBeenCalled();
  });

  it('preserves CIE-10 from copy source when remote initialization record already exists', async () => {
    const copySourceRecord = {
      ...mockRecord,
      date: '2024-12-31',
      beds: {
        R1: buildPatient({
          bedId: 'R1',
          patientName: 'Paciente remoto',
          cie10Code: 'I48.0',
          cie10Description: 'Fibrilacion auricular',
        }),
      },
    };
    const remoteRecord = {
      ...mockRecord,
      date: mockDate,
      beds: {
        R1: buildPatient({
          bedId: 'R1',
          patientName: 'Paciente remoto',
          cie10Code: undefined,
          cie10Description: undefined,
        }),
      },
    };

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date =>
      date === '2024-12-31' ? copySourceRecord : null
    );
    let mockDateFetchCount = 0;
    firestoreMock.getRecordFromFirestore.mockImplementation(async date => {
      if (date === '2024-12-31') return null;
      if (date === mockDate) {
        mockDateFetchCount += 1;
        return mockDateFetchCount >= 2 ? remoteRecord : null;
      }
      return null;
    });

    const result = await Repository.initializeDay(mockDate, '2024-12-31');

    expect(result.beds.R1.cie10Code).toBe('I48.0');
    expect(result.beds.R1.cie10Description).toBe('Fibrilacion auricular');
    expect(indexedDbFacadeMock.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            cie10Code: 'I48.0',
            cie10Description: 'Fibrilacion auricular',
          }),
        }),
      })
    );
  });

  it('creates a fresh record when Firestore has no record and legacy is isolated from initialization hot path', async () => {
    indexedDbFacadeMock.getRecordForDate.mockResolvedValueOnce(null);
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(null);
    legacyFirebaseMock.getLegacyRecord.mockResolvedValueOnce(mockRecord);

    const result = await Repository.initializeDay(mockDate);

    expect(result.date).toBe(mockDate);
    expect(result.beds).toBeDefined();
    expect(legacyFirebaseMock.getLegacyRecord).not.toHaveBeenCalled();
  });

  it('creates a fresh record if no previous day exists', async () => {
    indexedDbFacadeMock.getRecordForDate.mockResolvedValue(null);
    firestoreMock.getRecordFromFirestore.mockResolvedValue(null);
    indexedDbFacadeMock.getPreviousDayRecord.mockResolvedValue(null);

    const result = await Repository.initializeDay(mockDate);
    expect(result.date).toBe(mockDate);
    expect(result.beds).toBeDefined();
  });

  it('handles firestore errors during initializeDay gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    indexedDbFacadeMock.getRecordForDate.mockResolvedValue(null);
    firestoreMock.getRecordFromFirestore.mockRejectedValue(new Error('FS Error'));

    const result = await Repository.initializeDay(mockDate);
    expect(result.date).toBe(mockDate);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to check remote sources'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('resets CUDYR when copying from previous day', async () => {
    const prevRecord = {
      ...mockRecord,
      date: '2024-12-31',
      beds: {
        R1: buildPatient({
          patientName: 'Patient X',
          admissionDate: '2024-12-30',
          cudyr: buildCudyr({ changeClothes: 2 }),
        }),
      },
    };

    indexedDbFacadeMock.getRecordForDate.mockImplementation(async date =>
      date === '2024-12-31' ? prevRecord : null
    );
    firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(null);

    const result = await Repository.initializeDay(mockDate, '2024-12-31');

    expect(result.beds.R1.patientName).toBe('Patient X');
    expect(result.beds.R1.cudyr).toBeUndefined();
  });

  it('rejects invalid date format on initializeDay copyFromDate', async () => {
    await expect(Repository.initializeDay('2026-02-19', '19-02-2026')).rejects.toThrow(
      /Invalid date format/
    );
  });
});
