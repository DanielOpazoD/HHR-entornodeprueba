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

describe('useDailyRecord validation guards', () => {
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

  it('should not move patient if source bed is empty', async () => {
    recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
      beds: {
        R1: DataFactory.createMockPatient('R1', { patientName: '' }),
        R2: DataFactory.createMockPatient('R2', { patientName: '' }),
      },
    });

    const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.record?.beds['R1']).toBeDefined());

    act(() => {
      result.current.moveOrCopyPatient('move', 'R1', 'R2');
    });

    // Should NOT call updatePartial/save because source was empty
    expect(defaultDailyRecordRepositoryPort.updatePartial).not.toHaveBeenCalled();
  });

  it('should not update admissionDate to a future date', async () => {
    const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    const futureDateStr = '2099-01-01';

    act(() => {
      result.current.updatePatient('R1', 'admissionDate', futureDateStr);
    });

    expect(defaultDailyRecordRepositoryPort.updatePartial).not.toHaveBeenCalled();
  });

  it('should not create clinical crib in empty bed', async () => {
    recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
      beds: {
        R1: DataFactory.createMockPatient('R1', { patientName: '' }),
      },
    });

    const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.record?.beds['R1']).toBeDefined());

    act(() => {
      result.current.updateClinicalCrib('R1', 'create');
    });

    expect(defaultDailyRecordRepositoryPort.updatePartial).not.toHaveBeenCalled();
  });

  it('should not update crib admissionDate to a future date', async () => {
    const futureDateStr = '2099-01-01';

    recordsMap[mockDate] = DataFactory.createMockDailyRecord(mockDate, {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Mom',
          clinicalCrib: DataFactory.createMockPatient('R1', {
            patientName: 'Baby',
            admissionDate: '2025-01-01',
          }),
        }),
      },
    });

    const { result } = renderHook(() => useDailyRecord(mockDate), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.record?.beds['R1'].clinicalCrib).toBeDefined());

    act(() => {
      result.current.updateClinicalCrib('R1', 'admissionDate', futureDateStr);
    });

    expect(defaultDailyRecordRepositoryPort.updatePartial).not.toHaveBeenCalled();
  });
});
