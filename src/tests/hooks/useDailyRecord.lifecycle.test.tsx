import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { UIProvider } from '@/context/UIContext';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '../factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

const { mockDailyRecordPorts } = vi.hoisted(() => ({
  mockDailyRecordPorts: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    save: vi.fn().mockResolvedValue(undefined),
    saveDetailed: vi.fn().mockResolvedValue({
      date: '2025-01-01',
      outcome: 'clean',
      savedLocally: true,
      savedRemotely: true,
      queuedForRetry: false,
      autoMerged: false,
    }),
    updatePartial: vi.fn().mockResolvedValue(undefined),
    updatePartialDetailed: vi.fn().mockResolvedValue({
      date: '2025-01-01',
      outcome: 'clean',
      savedLocally: true,
      updatedRemotely: true,
      queuedForRetry: false,
      autoMerged: false,
      patchedFields: 1,
    }),
    initializeDay: vi.fn().mockResolvedValue(null),
    initializeDayDetailed: vi.fn().mockResolvedValue({
      record: null,
      outcome: 'clean',
      sourceCompatibilityIntensity: 'none',
      sourceMigrationRulesApplied: [],
    }),
    deleteDay: vi.fn().mockResolvedValue(undefined),
    syncWithFirestoreDetailed: vi.fn().mockResolvedValue({
      date: '2025-01-01',
      outcome: 'clean',
      record: null,
    }),
    syncWithFirestore: vi.fn().mockResolvedValue(null),
    getPreviousDay: vi.fn().mockResolvedValue(null),
    getAvailableDates: vi.fn().mockResolvedValue([]),
    getMonthRecords: vi.fn().mockResolvedValue([]),
    copyPatientToDate: vi.fn().mockResolvedValue(undefined),
    copyPatientToDateDetailed: vi.fn().mockResolvedValue({
      sourceDate: '2025-01-01',
      targetDate: '2025-01-02',
      outcome: 'clean',
      sourceBedId: 'R1',
      targetBedId: 'R2',
      sourceCompatibilityIntensity: 'none',
      sourceMigrationRulesApplied: [],
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock dependencies
vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: {
    getForDate: mockDailyRecordPorts.getForDate,
    getForDateWithMeta: mockDailyRecordPorts.getForDateWithMeta,
    getPreviousDayWithMeta: mockDailyRecordPorts.getPreviousDayWithMeta,
    getPreviousDay: mockDailyRecordPorts.getPreviousDay,
    getAvailableDates: mockDailyRecordPorts.getAvailableDates,
    getMonthRecords: mockDailyRecordPorts.getMonthRecords,
    initializeDay: mockDailyRecordPorts.initializeDay,
  },
  defaultDailyRecordWritePort: {
    delete: mockDailyRecordPorts.delete,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: mockDailyRecordPorts.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: {
    getForDate: mockDailyRecordPorts.getForDate,
    getForDateWithMeta: mockDailyRecordPorts.getForDateWithMeta,
    getPreviousDay: mockDailyRecordPorts.getPreviousDay,
    getPreviousDayWithMeta: mockDailyRecordPorts.getPreviousDayWithMeta,
    getAvailableDates: mockDailyRecordPorts.getAvailableDates,
    getMonthRecords: mockDailyRecordPorts.getMonthRecords,
    initializeDay: mockDailyRecordPorts.initializeDay,
    save: mockDailyRecordPorts.save,
    saveDetailed: mockDailyRecordPorts.saveDetailed,
    updatePartial: mockDailyRecordPorts.updatePartial,
    updatePartialDetailed: mockDailyRecordPorts.updatePartialDetailed,
    subscribe: mockDailyRecordPorts.subscribe,
    subscribeDetailed: vi.fn(() => vi.fn()),
    syncWithFirestoreDetailed: mockDailyRecordPorts.syncWithFirestoreDetailed,
    deleteDay: mockDailyRecordPorts.delete,
    copyPatientToDateDetailed: mockDailyRecordPorts.copyPatientToDateDetailed,
  },
}));

const createWrapper = () => {
  const { wrapper } = createQueryClientTestWrapper({
    config: {
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 0,
        },
      },
    },
    wrapChildren: children => <UIProvider>{children}</UIProvider>,
  });
  return wrapper;
};

describe('useDailyRecord lifecycle', () => {
  const mockDate = '2025-01-01';
  let recordsMap: Record<string, DailyRecord> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    recordsMap = {
      [mockDate]: DataFactory.createMockDailyRecord(mockDate),
    };

    const repo = mockDailyRecordPorts;
    const repoWithMeta = repo as typeof repo & {
      getForDateWithMeta: (date: string) => Promise<{
        date: string;
        record: DailyRecord | null;
        source: string;
        compatibilityTier: string;
        compatibilityIntensity: string;
        migrationRulesApplied: string[];
      }>;
    };

    vi.mocked(repo.getForDate).mockImplementation(async date => {
      return recordsMap[date] || null;
    });
    vi.mocked(repoWithMeta.getForDateWithMeta).mockImplementation(async (date: string) => ({
      date,
      record: recordsMap[date] || null,
      source: recordsMap[date] ? 'cache' : 'not_found',
      compatibilityTier: 'none',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
    }));

    vi.mocked(repo.initializeDay).mockImplementation(async date => {
      const rec = DataFactory.createMockDailyRecord(date);
      recordsMap[date] = rec;
      return rec;
    });
    vi.mocked(repo.initializeDayDetailed).mockImplementation(async date => {
      const rec = DataFactory.createMockDailyRecord(date);
      recordsMap[date] = rec;
      return {
        record: rec,
        outcome: 'clean',
        sourceCompatibilityIntensity: 'none',
        sourceMigrationRulesApplied: [],
      };
    });

    vi.mocked(repo.updatePartial).mockImplementation(async (date, partial) => {
      if (recordsMap[date]) {
        recordsMap[date] = applyPatches(recordsMap[date], partial);
      }
    });

    vi.mocked(repo.updatePartialDetailed).mockImplementation(async (date, partial) => {
      if (recordsMap[date]) {
        recordsMap[date] = applyPatches(recordsMap[date], partial);
      }
      return createUpdatePartialDailyRecordResult({
        date,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: Object.keys(partial).length,
      });
    });

    vi.mocked(repo.save).mockImplementation(async record => {
      recordsMap[record.date] = record;
    });

    vi.mocked(repo.saveDetailed).mockImplementation(async record => {
      recordsMap[record.date] = record;
      return createSaveDailyRecordResult({
        date: record.date,
        outcome: 'clean',
        savedLocally: true,
        savedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
      });
    });

    mockDailyRecordPorts.getForDateWithMeta.mockImplementation(async (date: string) => ({
      date,
      record: recordsMap[date] || null,
      source: recordsMap[date] ? 'indexeddb' : 'not_found',
      compatibilityTier: 'none',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
    }));
    mockDailyRecordPorts.getPreviousDayWithMeta.mockImplementation(async (date: string) => {
      const previousDate = Object.keys(recordsMap)
        .filter(candidate => candidate < date)
        .sort()
        .at(-1);

      return {
        date: previousDate || date,
        record: previousDate ? recordsMap[previousDate] : null,
        source: previousDate ? 'indexeddb' : 'not_found',
        compatibilityTier: 'none',
        compatibilityIntensity: 'none',
        migrationRulesApplied: [],
      };
    });
  });

  it('should initialize with record for the given date', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.record).not.toBeNull();
      expect(result.current.record?.date).toBe(mockDate);
    });
    expect(defaultDailyRecordRepositoryPort.getForDateWithMeta).toHaveBeenCalledWith(
      mockDate,
      false
    );
  });

  it('should update record when date changes', async () => {
    const { result, rerender } = renderHook(({ date }) => useDailyRecord(date), {
      initialProps: { date: mockDate },
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.record).not.toBeNull());

    const newDate = '2025-01-02';
    recordsMap[newDate] = DataFactory.createMockDailyRecord(newDate);

    rerender({ date: newDate });

    await waitFor(() => {
      expect(result.current.record?.date).toBe(newDate);
    });
  });

  it('should create a new day', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });

    // Wait for initial load (which might be null if currentRecord setup failed or similar)
    // But in our mock it returns currentRecord.

    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await result.current.createDay(false);
    });

    await waitFor(() => {
      expect(result.current.record?.date).toBe(mockDate);
    });
  });

  it('should not create a copied day before the selected day reaches 08:00', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 8, 0, 0));

    const futureDate = '2025-01-02';
    const { result } = renderHook(() => useDailyRecord(futureDate), { wrapper: createWrapper() });

    let created = true;
    await act(async () => {
      created = await result.current.createDay(true, mockDate);
    });

    expect(created).toBe(false);
    expect(mockDailyRecordPorts.initializeDayDetailed).not.toHaveBeenCalledWith(
      futureDate,
      mockDate
    );

    vi.useRealTimers();
  });

  it('should create a copied day when the selected day has reached 08:00', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 2, 8, 1, 0));

    const sourceDate = '2025-01-01';
    const targetDate = '2025-01-02';
    recordsMap[sourceDate] = DataFactory.createMockDailyRecord(sourceDate);
    const { result } = renderHook(() => useDailyRecord(targetDate), { wrapper: createWrapper() });

    let created = false;
    await act(async () => {
      created = await result.current.createDay(true, sourceDate);
    });

    expect(created).toBe(true);
    expect(defaultDailyRecordRepositoryPort.initializeDay).toHaveBeenCalledWith(
      targetDate,
      sourceDate
    );

    vi.useRealTimers();
  });

  it('should force the default copy source to the exact previous calendar day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 2, 8, 1, 0));

    const targetDate = '2025-01-02';
    const exactPreviousDate = '2025-01-01';
    recordsMap[exactPreviousDate] = DataFactory.createMockDailyRecord(exactPreviousDate);

    const { result } = renderHook(() => useDailyRecord(targetDate), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.createDay(true);
    });

    expect(defaultDailyRecordRepositoryPort.initializeDay).toHaveBeenCalledWith(
      targetDate,
      exactPreviousDate
    );

    vi.useRealTimers();
  });

  describe('copyPatientToDate', () => {
    it('should copy patient to a future date and specific bed', async () => {
      // Setup source record
      recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
        beds: {
          R1: DataFactory.createMockPatient('R1', {
            patientName: 'John Doe',
            rut: '12345678-9',
          }),
        },
      });

      // Setup target record (future date, empty bed)
      const targetDate = '2025-01-02';
      recordsMap[targetDate] = DataFactory.createMockDailyRecord(targetDate);

      const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });

      // Wait for initial load
      await waitFor(() => expect(result.current.record?.beds).toBeDefined());

      await act(async () => {
        await result.current.copyPatientToDate('R1', targetDate, 'R2');
      });

      // Verify copyPatientToDate called with correct arguments
      expect(defaultDailyRecordRepositoryPort.copyPatientToDateDetailed).toHaveBeenCalledWith(
        mockDate,
        'R1',
        targetDate,
        'R2'
      );
    });
  });
});
