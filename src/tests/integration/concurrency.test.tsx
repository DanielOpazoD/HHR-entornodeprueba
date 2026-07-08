import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { ConcurrencyError } from '@/services/storage/firestore';
import { DataFactory } from '../factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

// Mocks
const mockNotificationError = vi.fn();
const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    subscribeDetailed: vi.fn(() => () => {}),
    syncWithFirestore: vi.fn().mockResolvedValue(null),
    syncWithFirestoreDetailed: vi.fn().mockResolvedValue(null),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: mockDailyRecordRepositoryPort,
  defaultDailyRecordWritePort: {
    updatePartial: mockDailyRecordRepositoryPort.updatePartialDetailed,
    save: mockDailyRecordRepositoryPort.saveDetailed,
    delete: mockDailyRecordRepositoryPort.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: mockDailyRecordRepositoryPort.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: mockDailyRecordRepositoryPort,
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    error: mockNotificationError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../firebaseConfig', () => ({
  auth: { onAuthStateChanged: vi.fn(() => () => {}) },
}));

vi.mock('../../services/storage/unifiedLocalService', () => ({
  saveRecordLocal: vi.fn(),
}));

const mockDate = '2024-12-28';

const createWrapper = () => {
  const { wrapper } = createQueryClientTestWrapper();
  return wrapper;
};

describe('Concurrency Handling Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDailyRecordFreshnessGateForTests();
    const record = DataFactory.createMockDailyRecord(mockDate);
    vi.mocked(mockDailyRecordRepositoryPort.getForDate).mockResolvedValue(record);
    vi.mocked(mockDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue({
      date: mockDate,
      record,
      source: 'indexeddb',
      compatibilityTier: 'none',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      consistencyState: 'local_only',
      sourceOfTruth: 'local',
      retryability: 'not_applicable',
      recoveryAction: 'none',
      conflictSummary: null,
      observabilityTags: ['daily_record', 'read'],
      repairApplied: false,
    });
  });

  it('should handle ConcurrencyError correctly', async () => {
    // Setup: Repository throws ConcurrencyError on save
    vi.mocked(mockDailyRecordRepositoryPort.saveDetailed).mockRejectedValue(
      new ConcurrencyError('Remote is newer')
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.record).not.toBeNull();
    });

    const newRecord = { ...result.current.record! };

    // Action: Try to save
    await act(async () => {
      await result.current.saveAndUpdate(newRecord).catch(() => undefined);
    });

    // Assertions
    await waitFor(() => {
      expect(result.current.syncStatus).toBe('error');
      expect(mockNotificationError).toHaveBeenCalledWith('Conflicto de Edición', 'Remote is newer');
    });

    // Verify Refresh Logic
    // The hook sets a timeout of 2000ms to refresh
    vi.mocked(mockDailyRecordRepositoryPort.getForDateWithMeta).mockClear();

    await waitFor(
      () => {
        expect(mockDailyRecordRepositoryPort.getForDateWithMeta).toHaveBeenCalledWith(
          mockDate,
          false
        );
      },
      { timeout: 3000 }
    );
  });
});
