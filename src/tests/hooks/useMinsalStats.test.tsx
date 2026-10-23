import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { queryClient as appQueryClient } from '@/config/queryClient';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useMinsalStats } from '@/hooks/useMinsalStats';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { MinsalStatistics } from '@/types/minsalTypes';

const mockFetchRecordsRangeSorted = vi.fn();
const mockSyncRecordsRange = vi.fn();
const mockCalculateMinsalStats = vi.fn();
const mockFilterRecordsByDateRange = vi.fn();
const mockGenerateDailyTrend = vi.fn();
const mockGetDateRangeFromPreset = vi.fn();
const mockCallable = vi.fn();
const mockGetFunctionsInstance = vi.fn();
const mockFetchReclassifications = vi.fn();
const mockSaveReclassification = vi.fn();

vi.mock('@/services/records/recordQueryService', () => ({
  fetchRecordsRangeSorted: (...args: unknown[]) => mockFetchRecordsRangeSorted(...args),
  syncRecordsRange: (...args: unknown[]) => mockSyncRecordsRange(...args),
}));

vi.mock('@/services/calculations/minsalStatsCalculator', () => ({
  calculateMinsalStats: (...args: unknown[]) => mockCalculateMinsalStats(...args),
  filterRecordsByDateRange: (...args: unknown[]) => mockFilterRecordsByDateRange(...args),
  generateDailyTrend: (...args: unknown[]) => mockGenerateDailyTrend(...args),
  getDateRangeFromPreset: (...args: unknown[]) => mockGetDateRangeFromPreset(...args),
}));

vi.mock('@/firebaseConfig', () => ({
  getFunctionsInstance: (...args: unknown[]) => mockGetFunctionsInstance(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('@/services/analytics/analyticsSpecialtyReclassificationService', () => ({
  fetchAnalyticsSpecialtyReclassifications: (...args: unknown[]) =>
    mockFetchReclassifications(...args),
  saveAnalyticsSpecialtyReclassification: (...args: unknown[]) => mockSaveReclassification(...args),
}));

const buildStats = (overrides?: Partial<MinsalStatistics>): MinsalStatistics => ({
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  totalDays: 31,
  calendarDays: 31,
  diasCamaDisponibles: 558,
  diasCamaOcupados: 390,
  tasaOcupacion: 69.9,
  promedioDiasEstada: 4.2,
  egresosTotal: 40,
  egresosVivos: 36,
  egresosFallecidos: 2,
  egresosTraslados: 2,
  mortalidadHospitalaria: 5,
  indiceRotacion: 2.1,
  pacientesActuales: 13,
  camasOcupadas: 13,
  camasBloqueadas: 0,
  camasDisponibles: 18,
  camasLibres: 5,
  tasaOcupacionActual: 72.2,
  porEspecialidad: [],
  ...overrides,
});

describe('useMinsalStats', () => {
  const createWrapper = () =>
    createQueryClientTestWrapper({
      config: {
        defaultOptions: {
          queries: {
            retry: false,
            gcTime: 0,
            staleTime: 0,
          },
        },
      },
    }).wrapper;

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDateRangeFromPreset.mockReturnValue({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
    mockGetFunctionsInstance.mockResolvedValue({});
    mockFetchReclassifications.mockResolvedValue([]);
    mockSaveReclassification.mockResolvedValue(undefined);
    mockFilterRecordsByDateRange.mockImplementation(
      (records: DailyRecord[], startDate: string, endDate: string) =>
        records.filter(record => record.date >= startDate && record.date <= endDate)
    );
    mockGenerateDailyTrend.mockReturnValue([
      {
        date: '2026-03-31',
        ocupadas: 13,
        disponibles: 18,
        bloqueadas: 0,
        egresos: 0,
        fallecidos: 0,
        tasaOcupacion: 72.2,
      },
    ]);
  });

  it('prefers local synchronized stats over mismatched remote stats', async () => {
    const localRecords = [{ date: '2026-03-31' } as DailyRecord];
    const localStats = buildStats({ tasaOcupacion: 69.9 });
    const remoteStats = buildStats({ tasaOcupacion: 30.1 });

    mockFetchRecordsRangeSorted.mockResolvedValue(localRecords);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockCalculateMinsalStats.mockReturnValue(localStats);
    mockCallable.mockResolvedValue({ data: remoteStats });

    const { result } = renderHook(() => useMinsalStats('lastMonth'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    expect(result.current.stats?.tasaOcupacion).toBe(69.9);
    expect(result.current.trendData).toHaveLength(1);
    expect(mockCalculateMinsalStats).toHaveBeenCalledWith(
      localRecords,
      '2026-03-01',
      '2026-03-31',
      { specialtyReclassifications: [] }
    );
    // The screen does not wait for, nor ask, the server calculation it would not show.
    expect(result.current.isLoading).toBe(false);
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('uses persisted specialty reclassifications locally without asking the server', async () => {
    const localRecords = [{ date: '2026-03-31' } as DailyRecord];
    const localStats = buildStats({ tasaOcupacion: 69.9 });
    const options = {
      specialtyGroupingMode: 'group-other' as const,
      specialtyReclassifications: [
        {
          date: '2026-03-31',
          movementKind: 'discharge' as const,
          movementId: 'd-1',
          specialty: 'Cirugía',
        },
      ],
    };
    const persistedReclassifications = [
      {
        date: '2026-03-31',
        movementKind: 'discharge' as const,
        movementId: 'd-1',
        specialty: 'Cirugía',
      },
      {
        date: '2026-02-28',
        movementKind: 'transfer' as const,
        movementId: 't-previous',
        specialty: 'Medicina Interna',
      },
    ];

    mockFetchRecordsRangeSorted.mockResolvedValue(localRecords);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockFetchReclassifications.mockResolvedValue(persistedReclassifications);
    mockCalculateMinsalStats.mockReturnValue(localStats);
    mockCallable.mockResolvedValue({ data: buildStats({ tasaOcupacion: 30.1 }) });

    const { result } = renderHook(() => useMinsalStats('lastMonth', options), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    expect(mockCalculateMinsalStats).toHaveBeenCalledWith(
      localRecords,
      '2026-03-01',
      '2026-03-31',
      {
        specialtyGroupingMode: 'group-other',
        specialtyReclassifications: persistedReclassifications,
      }
    );
    expect(result.current.reclassifications).toEqual([persistedReclassifications[0]]);
    expect(mockFetchReclassifications).toHaveBeenCalledWith(
      '2026-01-29',
      '2026-03-31',
      'hanga_roa'
    );
    // Local records cover the range, so the server calculation would never be shown.
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('sends only server-owned options when the server calculation is the one shown', async () => {
    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockCalculateMinsalStats.mockReturnValue(null);
    mockCallable.mockResolvedValue({ data: buildStats({ tasaOcupacion: 30.1 }) });
    const options = {
      specialtyGroupingMode: 'group-other' as const,
      specialtyReclassifications: [
        {
          date: '2026-03-31',
          movementKind: 'discharge' as const,
          movementId: 'd-1',
          specialty: 'Cirugía',
        },
      ],
    };

    const { result } = renderHook(() => useMinsalStats('lastMonth', options), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.stats?.tasaOcupacion).toBe(30.1));
    expect(mockCallable).toHaveBeenCalledExactlyOnceWith({
      hospitalId: 'hanga_roa',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      options: {
        specialtyGroupingMode: 'group-other',
      },
    });
  });

  it('asks the server when the local records cannot be read', async () => {
    mockFetchRecordsRangeSorted.mockRejectedValue(new Error('synthetic local failure'));
    mockCallable.mockResolvedValue({ data: buildStats({ tasaOcupacion: 44.4 }) });

    const { result } = renderHook(() => useMinsalStats('lastMonth'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.stats?.tasaOcupacion).toBe(44.4));
    expect(mockCallable).toHaveBeenCalledTimes(1);
  });

  it('falls back to remote stats when there is no synchronized local range data', async () => {
    const remoteStats = buildStats({ tasaOcupacion: 61.4, pacientesActuales: 11 });

    mockFetchRecordsRangeSorted.mockResolvedValue([]);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockCalculateMinsalStats.mockReturnValue(null);
    mockGenerateDailyTrend.mockReturnValue([]);
    mockCallable.mockResolvedValue({ data: remoteStats });

    const { result } = renderHook(() => useMinsalStats('lastMonth'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.stats).not.toBeNull());

    expect(result.current.stats?.tasaOcupacion).toBe(61.4);
    expect(result.current.stats?.pacientesActuales).toBe(11);
    expect(result.current.trendData).toEqual([]);
  });

  it('refreshes the active local range when a local record changes inside that range', async () => {
    const initialRecords = [{ date: '2026-03-31' } as DailyRecord];
    const refreshedRecords = [
      { date: '2026-03-31' } as DailyRecord,
      { date: '2026-03-14' } as DailyRecord,
    ];

    mockFetchRecordsRangeSorted
      .mockResolvedValueOnce(initialRecords)
      .mockResolvedValueOnce(refreshedRecords);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockCalculateMinsalStats
      .mockReturnValueOnce(buildStats({ pacientesActuales: 13 }))
      .mockReturnValueOnce(buildStats({ pacientesActuales: 14 }));
    mockCallable.mockResolvedValue({ data: buildStats({ tasaOcupacion: 30.1 }) });

    const { result } = renderHook(() => useMinsalStats('lastMonth'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.allRecords).toEqual(initialRecords);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2026-03-14'] },
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.allRecords).toEqual(refreshedRecords);
    });

    expect(result.current.stats?.pacientesActuales).toBe(14);
    expect(mockFetchRecordsRangeSorted).toHaveBeenCalledTimes(2);
    expect(mockFetchRecordsRangeSorted).toHaveBeenNthCalledWith(1, '2026-01-29', '2026-03-31');
    expect(mockFetchRecordsRangeSorted).toHaveBeenNthCalledWith(2, '2026-01-29', '2026-03-31');
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('ignores local record changes outside the active range', async () => {
    const initialRecords = [{ date: '2026-03-31' } as DailyRecord];

    mockFetchRecordsRangeSorted.mockResolvedValue(initialRecords);
    mockSyncRecordsRange.mockResolvedValue([]);
    mockCalculateMinsalStats.mockReturnValue(buildStats({ pacientesActuales: 13 }));
    mockCallable.mockResolvedValue({ data: buildStats({ tasaOcupacion: 30.1 }) });

    const { result } = renderHook(() => useMinsalStats('lastMonth'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.allRecords).toEqual(initialRecords);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2026-04-01'] },
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.allRecords).toEqual(initialRecords);
    });

    expect(mockFetchRecordsRangeSorted).toHaveBeenCalledTimes(1);
    expect(mockCallable).not.toHaveBeenCalled();
  });

  describe('remote range sync', () => {
    const storeChanged = (date: string) =>
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );
    const settle = () =>
      act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

    beforeEach(() => {
      // A range with days that have no census never looks complete locally.
      mockFetchRecordsRangeSorted.mockResolvedValue([{ date: '2026-03-31' } as DailyRecord]);
      // Storing synced records fires the store-change event, as saveRecordsStrict does.
      mockSyncRecordsRange.mockImplementation(async () => {
        storeChanged('2026-03-14');
        return [{ date: '2026-03-14' } as DailyRecord];
      });
      mockCalculateMinsalStats.mockReturnValue(buildStats());
      mockCallable.mockResolvedValue({ data: buildStats() });
    });

    it('syncs an incomplete range once instead of looping on its own store events', async () => {
      renderHook(() => useMinsalStats('lastMonth'), { wrapper: createWrapper() });
      await waitFor(() => expect(mockSyncRecordsRange).toHaveBeenCalled());
      await settle();
      // Another tab broadcasting a change inside the range does not trigger another download.
      await act(async () => {
        storeChanged('2026-03-20');
      });
      await settle();
      expect(mockSyncRecordsRange).toHaveBeenCalledTimes(1);
    });

    it('still asks the server again on a manual refresh', async () => {
      const { result } = renderHook(() => useMinsalStats('lastMonth'), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(mockSyncRecordsRange).toHaveBeenCalledTimes(1));
      await settle();
      await act(async () => {
        await result.current.refresh();
      });
      await settle();
      expect(mockSyncRecordsRange).toHaveBeenCalledTimes(2);
    });
  });

  describe('local rescans and tab visibility', () => {
    const records = [{ date: '2026-03-31' } as DailyRecord];
    const storeChanged = (date: string) =>
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );
    const settle = () =>
      act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

    beforeEach(() => {
      mockFetchRecordsRangeSorted.mockResolvedValue(records);
      mockSyncRecordsRange.mockResolvedValue([]);
      mockCalculateMinsalStats.mockReturnValue(buildStats());
    });

    it('only marks the range stale in a hidden tab and rescans once on return', async () => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { result } = renderHook(() => useMinsalStats('lastMonth'), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.allRecords).toEqual(records));
      const readsBefore = mockFetchRecordsRangeSorted.mock.calls.length;
      try {
        visibility.mockReturnValue('hidden');
        act(() => focusManager.setFocused(false));
        await act(async () => {
          ['2026-03-10', '2026-03-11', '2026-03-12'].forEach(storeChanged);
        });
        await settle();
        expect(mockFetchRecordsRangeSorted).toHaveBeenCalledTimes(readsBefore);

        visibility.mockReturnValue('visible');
        act(() => focusManager.setFocused(true));
        await waitFor(() =>
          expect(mockFetchRecordsRangeSorted).toHaveBeenCalledTimes(readsBefore + 1)
        );
      } finally {
        focusManager.setFocused(undefined);
        visibility.mockRestore();
      }
    });

    it('does not rescan the local days on a tab return when nothing changed', async () => {
      // The app's defaults refetch every query on every tab return, even when fresh.
      const { queryClient, wrapper } = createQueryClientTestWrapper({
        config: { defaultOptions: appQueryClient.getDefaultOptions() },
      });
      const { result } = renderHook(() => useMinsalStats('lastMonth'), { wrapper });
      await waitFor(() => expect(result.current.allRecords).toEqual(records));
      const readsBefore = mockFetchRecordsRangeSorted.mock.calls.length;
      try {
        act(() => {
          focusManager.setFocused(false);
          focusManager.setFocused(true);
        });
        await settle();
        expect(mockFetchRecordsRangeSorted).toHaveBeenCalledTimes(readsBefore);
      } finally {
        focusManager.setFocused(undefined);
        queryClient.clear();
      }
    });
  });
});
