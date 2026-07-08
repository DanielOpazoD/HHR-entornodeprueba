import { act, renderHook, waitFor } from '@testing-library/react';
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
  });

  it('uses persisted specialty reclassifications locally and keeps remote calculations server-owned', async () => {
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
    expect(mockCallable).toHaveBeenCalledWith({
      hospitalId: 'hanga_roa',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      options: {
        specialtyGroupingMode: 'group-other',
      },
    });
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
    expect(mockCallable).toHaveBeenCalledTimes(1);
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
    expect(mockCallable).toHaveBeenCalledTimes(1);
  });
});
