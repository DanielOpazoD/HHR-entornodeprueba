import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePatientAnalysis } from '@/features/admin/hooks/usePatientAnalysis';
import {
  defaultDailyRecordAnalysisPort,
  defaultDailyRecordReadPort,
  defaultDailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import { defaultPatientMasterWritePort } from '@/application/ports/patientMasterPort';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: {
    getAvailableDates: vi.fn(),
    getForDate: vi.fn(),
  },
  defaultDailyRecordWritePort: {
    updatePartial: vi.fn(),
  },
  defaultDailyRecordAnalysisPort: {
    getAvailableDates: vi.fn(),
    getForDate: vi.fn(),
    updatePartial: vi.fn(),
  },
}));

vi.mock('@/application/ports/patientMasterPort', () => ({
  defaultPatientMasterWritePort: {
    bulkUpsertPatients: vi.fn(),
  },
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: vi.fn().mockReturnValue('test@test.com'),
}));

describe('usePatientAnalysis — conflict resolution, migration & errors', () => {
  const asRepoRecord = <T>(value: T) =>
    value as unknown as Awaited<ReturnType<typeof defaultDailyRecordReadPort.getForDate>>;

  const dailyRecordAnalysisPort = vi.mocked(defaultDailyRecordAnalysisPort);
  const dailyRecordReadPort = vi.mocked(defaultDailyRecordReadPort);
  const dailyRecordWritePort = vi.mocked(defaultDailyRecordWritePort);
  const patientMasterWritePort = vi.mocked(defaultPatientMasterWritePort);

  beforeEach(() => {
    vi.clearAllMocks();
    dailyRecordAnalysisPort.getAvailableDates.mockImplementation(
      dailyRecordReadPort.getAvailableDates
    );
    dailyRecordAnalysisPort.getForDate.mockImplementation(dailyRecordReadPort.getForDate);
    dailyRecordAnalysisPort.updatePartial.mockImplementation(dailyRecordWritePort.updatePartial);
  });

  it('should resolve conflicts and harmonize history', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Old' } },
    };
    const record2 = {
      date: '2025-01-02',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John New' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    dailyRecordWritePort.updatePartial.mockImplementation(async date => {
      await Promise.resolve();

      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );

      return undefined as unknown as Awaited<
        ReturnType<typeof defaultDailyRecordWritePort.updatePartial>
      >;
    });

    await act(async () => {
      await result.current.resolveConflict('11.111.111-1', 'John Doe', true);
    });

    expect(dailyRecordWritePort.updatePartial).toHaveBeenCalled();
    expect(result.current.analysis?.conflicts).toHaveLength(0);
    expect(result.current.isStale).toBe(false);
  });

  it('marks analysis stale when an unrelated store change happens during harmonization', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Old' } },
    };
    const record2 = {
      date: '2025-01-02',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John New' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    dailyRecordWritePort.updatePartial.mockImplementation(async date => {
      await Promise.resolve();

      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2025-01-03'] },
        })
      );

      return undefined as unknown as Awaited<
        ReturnType<typeof defaultDailyRecordWritePort.updatePartial>
      >;
    });

    await act(async () => {
      await result.current.resolveConflict('11.111.111-1', 'John Doe', true);
    });

    expect(result.current.analysis?.conflicts).toHaveLength(0);
    expect(result.current.isStale).toBe(true);
  });

  it('marks analysis stale when an extra same-date save happens during harmonization', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Old' } },
    };
    const record2 = {
      date: '2025-01-02',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John New' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    dailyRecordWritePort.updatePartial.mockImplementation(async date => {
      await Promise.resolve();

      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );

      return undefined as unknown as Awaited<
        ReturnType<typeof defaultDailyRecordWritePort.updatePartial>
      >;
    });

    await act(async () => {
      await result.current.resolveConflict('11.111.111-1', 'John Doe', true);
    });

    expect(result.current.analysis?.conflicts).toHaveLength(0);
    expect(result.current.isStale).toBe(true);
  });

  it('should resolve conflict without harmonization', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const r1 = { beds: { B1: { rut: '11.111.111-1', patientName: 'N1' } } };
    const r2 = { beds: { B1: { rut: '11.111.111-1', patientName: 'N2' } } };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(r1))
      .mockResolvedValueOnce(asRepoRecord(r2));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    await act(async () => {
      await result.current.resolveConflict('11.111.111-1', 'Correct Name', false);
    });

    expect(dailyRecordWritePort.updatePartial).not.toHaveBeenCalled();
    expect(result.current.analysis?.validPatients[0].fullName).toBe('Correct Name');
  });

  it('should return early in resolveConflict if conflict or analysis missing', async () => {
    const { result } = renderHook(() => usePatientAnalysis());

    // No analysis run yet
    await act(async () => {
      await result.current.resolveConflict('123', 'Name', true);
    });
    expect(dailyRecordWritePort.updatePartial).not.toHaveBeenCalled();
  });

  it('should run migration and handle success', async () => {
    const mockDates = ['2025-01-01'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John D.' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(record1));
    patientMasterWritePort.bulkUpsertPatients.mockResolvedValue({
      successes: 1,
      errors: 0,
    });

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    await act(async () => {
      await result.current.runMigration();
    });

    expect(result.current.migrationResult?.successes).toBe(1);
  });

  it('should handle migration failure', async () => {
    const mockDates = ['2025-01-01'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(record1));
    patientMasterWritePort.bulkUpsertPatients.mockRejectedValue(new Error('Migration fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });
    await act(async () => {
      await result.current.runMigration();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[usePatientAnalysis] Migration failed'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('should prefer userSafeMessage for migration failures', async () => {
    const mockDates = ['2025-01-01'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(record1));
    patientMasterWritePort.bulkUpsertPatients.mockRejectedValue(new Error('Migration fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });
    await act(async () => {
      await result.current.runMigration();
    });

    expect(consoleSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ message: 'Migration fail' })
    );
    consoleSpy.mockRestore();
  });

  it('should handle analysis failure', async () => {
    dailyRecordReadPort.getAvailableDates.mockRejectedValue(new Error('Analysis fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[usePatientAnalysis] Analysis failed'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('should prefer userSafeMessage for analysis failures', async () => {
    dailyRecordReadPort.getAvailableDates.mockRejectedValue(new Error('Analysis fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(consoleSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ message: 'Analysis fail' })
    );
    consoleSpy.mockRestore();
  });

  it('uses injected dependencies instead of default ports', async () => {
    const customDailyRecordRepository = {
      getAvailableDates: vi.fn().mockResolvedValue(['2025-01-01']),
      getForDate: vi.fn().mockResolvedValue(
        asRepoRecord({
          date: '2025-01-01',
          beds: { B1: { rut: '11.111.111-1', patientName: 'Injected Patient' } },
        })
      ),
      updatePartial: vi.fn(),
    };
    const customPatientMasterRepository = {
      bulkUpsertPatients: vi.fn().mockResolvedValue({ successes: 1, errors: 0 }),
    };
    const customAuditPort = {
      writeEvent: vi.fn().mockResolvedValue(undefined),
    };
    const getInjectedUserEmail = vi.fn().mockReturnValue('inject@test.com');

    const { result } = renderHook(() =>
      usePatientAnalysis({
        dailyRecordRepository: customDailyRecordRepository,
        patientMasterRepository: customPatientMasterRepository,
        auditPort: customAuditPort,
        getCurrentUserEmail: getInjectedUserEmail,
      })
    );

    await act(async () => {
      await result.current.runAnalysis();
    });

    await act(async () => {
      await result.current.runMigration();
    });

    expect(customDailyRecordRepository.getAvailableDates).toHaveBeenCalled();
    expect(customDailyRecordRepository.getForDate).toHaveBeenCalledWith('2025-01-01');
    expect(customPatientMasterRepository.bulkUpsertPatients).toHaveBeenCalled();
    expect(dailyRecordReadPort.getAvailableDates).not.toHaveBeenCalled();
    expect(patientMasterWritePort.bulkUpsertPatients).not.toHaveBeenCalled();
  });
});
