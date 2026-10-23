/**
 * useMinsalStats Hook
 * React hook for MINSAL/DEIS hospital statistics with range-based loading.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import { fetchRecordsRangeSorted, syncRecordsRange } from '@/services/records/recordQueryService';
import {
  fetchAnalyticsSpecialtyReclassifications,
  saveAnalyticsSpecialtyReclassification,
  type SaveAnalyticsSpecialtyReclassificationRequest,
} from '@/services/analytics/analyticsSpecialtyReclassificationService';
import {
  calculateMinsalStats as calculateMinsalStatsLocal,
  filterRecordsByDateRange,
  generateDailyTrend,
  getDateRangeFromPreset,
} from '@/services/calculations/minsalStatsCalculator';
import { resolveDisplayedMinsalStats } from '@/hooks/controllers/minsalStatsPresentationController';
import {
  buildAnalyticsDataQualityIssues,
  buildMinsalComparisonSummary,
  resolvePreviousMinsalPeriod,
} from '@/services/calculations/minsal/minsalStatsInsights';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import {
  AnalyticsDataQualityIssue,
  DailyStatsSnapshot,
  DateRangeConfig,
  DateRangePreset,
  MinsalCalculationOptions,
  MinsalComparisonSummary,
  MinsalStatistics,
  SpecialtyReclassification,
} from '@/types/minsalTypes';
import type { MinsalDailyRecord as DailyRecord } from '@/services/calculations/minsal/minsalRecordContracts';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
  isDailyRecordStoreChangeRelevantToRange,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { diffCalendarDays } from '@/utils/clinicalDateUtils';

interface UseMinsalStatsResult {
  stats: MinsalStatistics | null;
  trendData: DailyStatsSnapshot[];
  allRecords: DailyRecord[];
  dateRange: DateRangeConfig;
  setPreset: (preset: DateRangePreset) => void;
  setCustomRange: (startDate: string, endDate: string) => void;
  setCurrentYearMonth: (month: number) => void;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  comparison: MinsalComparisonSummary | null;
  dataQualityIssues: AnalyticsDataQualityIssue[];
  reclassifications: SpecialtyReclassification[];
  saveReclassification: (
    request: Omit<SaveAnalyticsSpecialtyReclassificationRequest, 'hospitalId'>
  ) => Promise<void>;
  isSavingReclassification: boolean;
}

// Calendar days, counted at UTC noon: a local-midnight count gains a day across a daylight-saving
// change and then the range never looks complete.
const getDaysInRange = (start: string, end: string): number =>
  (diffCalendarDays(start, end) ?? 0) + 1;

// A range with days that have no census never looks complete locally, and each remote sync stores
// records, which fires the store-change event that refetches this query. Without a pause that loop
// re-downloads the whole range for as long as the view stays open (and between tabs).
const REMOTE_RANGE_SYNC_INTERVAL_MS = 2 * 60 * 1000;

const mergeByDateDesc = (base: DailyRecord[], incoming: DailyRecord[]): DailyRecord[] => {
  const merged = new Map<string, DailyRecord>();
  base.forEach(record => merged.set(record.date, record));
  incoming.forEach(record => merged.set(record.date, record));
  return Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export function useMinsalStats(
  initialPreset: DateRangePreset = 'lastMonth',
  calculationOptions: MinsalCalculationOptions = {}
): UseMinsalStatsResult {
  const queryClient = useQueryClient();
  const hospitalId = getActiveHospitalId();
  const lastRemoteRangeSyncRef = useRef(new Map<string, number>());
  const [dateRange, setDateRange] = useState<DateRangeConfig>({ preset: initialPreset });
  const safeRemoteOptions = useMemo(
    () => ({
      specialtyGroupingMode: calculationOptions.specialtyGroupingMode,
    }),
    [calculationOptions.specialtyGroupingMode]
  );

  const { startDate, endDate } = useMemo(() => {
    try {
      return getDateRangeFromPreset(
        dateRange.preset,
        dateRange.startDate,
        dateRange.endDate,
        dateRange.currentYearMonth
      );
    } catch {
      const today = getTodayISO();
      return { startDate: today, endDate: today };
    }
  }, [dateRange]);
  const { previousPeriodStart, previousPeriodEnd } = useMemo(
    () => resolvePreviousMinsalPeriod(startDate, endDate),
    [startDate, endDate]
  );

  const localRecordsQueryKey = useMemo(
    () => queryKeys.analytics.recordsRange(previousPeriodStart, endDate),
    [previousPeriodStart, endDate]
  );
  const remoteStatsQueryKey = useMemo(
    () =>
      [
        ...queryKeys.analytics.remoteStats(hospitalId, startDate, endDate),
        JSON.stringify(safeRemoteOptions),
      ] as const,
    [hospitalId, startDate, endDate, safeRemoteOptions]
  );
  const reclassificationsQueryKey = useMemo(
    () => queryKeys.analytics.specialtyReclassifications(hospitalId, previousPeriodStart, endDate),
    [hospitalId, previousPeriodStart, endDate]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStoreChanged = (event: Event) => {
      const detail = (event as CustomEvent<DailyRecordStoreChangedEventDetail>).detail;
      if (!isDailyRecordStoreChangeRelevantToRange(detail, previousPeriodStart, endDate)) {
        return;
      }

      // Never cancel a fetch that is still storing its own synced records. A hidden tab
      // only marks the range stale: it rescans the local days once, when it is shown again.
      void queryClient.invalidateQueries(
        {
          queryKey: localRecordsQueryKey,
          exact: true,
          refetchType: document.visibilityState === 'hidden' ? 'none' : 'active',
        },
        { cancelRefetch: false }
      );
    };

    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
    return () => window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
  }, [queryClient, localRecordsQueryKey, previousPeriodStart, endDate]);

  const recordsQuery = useQuery({
    queryKey: localRecordsQueryKey,
    queryFn: async (): Promise<DailyRecord[]> => {
      const localRecords = await fetchRecordsRangeSorted(previousPeriodStart, endDate);
      const expectedDays = getDaysInRange(previousPeriodStart, endDate);

      if (localRecords.length >= expectedDays) {
        return localRecords;
      }

      const rangeKey = `${previousPeriodStart}:${endDate}`;
      const lastSyncAt = lastRemoteRangeSyncRef.current.get(rangeKey);
      if (lastSyncAt !== undefined && Date.now() - lastSyncAt < REMOTE_RANGE_SYNC_INTERVAL_MS) {
        return localRecords;
      }
      lastRemoteRangeSyncRef.current.set(rangeKey, Date.now());
      const syncedRecords = await syncRecordsRange(previousPeriodStart, endDate);
      if (syncedRecords.length === 0) {
        return localRecords;
      }

      return mergeByDateDesc(localRecords, syncedRecords);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    // Every local change in the range already invalidates this query, so a tab return only
    // rescans when something changed or the data is older than its stale time.
    refetchOnWindowFocus: true,
  });

  const rangeRecords = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);
  const currentRangeRecords = useMemo(
    () => filterRecordsByDateRange(rangeRecords, startDate, endDate),
    [rangeRecords, startDate, endDate]
  );

  const remoteStatsQuery = useQuery({
    queryKey: remoteStatsQueryKey,
    // The screen shows the local stats whenever this range has local records (see
    // resolveDisplayedMinsalStats), so the server calculation, which reads every day of the
    // range, only runs when it is the one shown: no local records, or the local read failed.
    enabled: recordsQuery.isError || (recordsQuery.isSuccess && currentRangeRecords.length === 0),
    queryFn: async (): Promise<MinsalStatistics> => {
      const functions = await defaultFunctionsRuntime.getFunctions();
      const calculateStats = httpsCallable(functions, 'calculateMinsalStats');
      const result = await calculateStats({
        hospitalId,
        startDate,
        endDate,
        options: safeRemoteOptions,
      });
      return result.data as MinsalStatistics;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });

  const reclassificationsQuery = useQuery({
    queryKey: reclassificationsQueryKey,
    queryFn: () =>
      fetchAnalyticsSpecialtyReclassifications(previousPeriodStart, endDate, hospitalId),
    staleTime: 2 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });

  const saveReclassificationMutation = useMutation({
    mutationFn: (request: Omit<SaveAnalyticsSpecialtyReclassificationRequest, 'hospitalId'>) =>
      saveAnalyticsSpecialtyReclassification({ ...request, hospitalId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reclassificationsQueryKey }),
        queryClient.invalidateQueries({ queryKey: remoteStatsQueryKey }),
      ]);
    },
  });

  const previousRangeRecords = useMemo(
    () => filterRecordsByDateRange(rangeRecords, previousPeriodStart, previousPeriodEnd),
    [rangeRecords, previousPeriodEnd, previousPeriodStart]
  );
  const allPeriodReclassifications = useMemo(
    () => reclassificationsQuery.data ?? [],
    [reclassificationsQuery.data]
  );
  const reclassifications = useMemo(
    () =>
      allPeriodReclassifications.filter(
        item => !item.date || (item.date >= startDate && item.date <= endDate)
      ),
    [allPeriodReclassifications, endDate, startDate]
  );
  const effectiveCalculationOptions = useMemo<MinsalCalculationOptions>(
    () => ({
      ...calculationOptions,
      specialtyReclassifications: allPeriodReclassifications,
    }),
    [allPeriodReclassifications, calculationOptions]
  );

  const trendData = useMemo(() => {
    if (currentRangeRecords.length === 0) return [];
    return generateDailyTrend(currentRangeRecords);
  }, [currentRangeRecords]);

  const localRangeStats = useMemo(() => {
    if (currentRangeRecords.length === 0) {
      return null;
    }
    return calculateMinsalStatsLocal(
      currentRangeRecords,
      startDate,
      endDate,
      effectiveCalculationOptions
    );
  }, [currentRangeRecords, startDate, endDate, effectiveCalculationOptions]);

  const previousLocalStats = useMemo(() => {
    if (previousRangeRecords.length === 0) {
      return null;
    }
    return calculateMinsalStatsLocal(
      previousRangeRecords,
      previousPeriodStart,
      previousPeriodEnd,
      effectiveCalculationOptions
    );
  }, [effectiveCalculationOptions, previousPeriodEnd, previousPeriodStart, previousRangeRecords]);

  const localFallbackStats = useMemo(() => {
    if (!remoteStatsQuery.isError) {
      return null;
    }
    return localRangeStats;
  }, [remoteStatsQuery.isError, localRangeStats]);

  const stats = useMemo<MinsalStatistics | null>(() => {
    return resolveDisplayedMinsalStats({
      localStats: localRangeStats,
      remoteStats: remoteStatsQuery.data ?? localFallbackStats,
    });
  }, [localFallbackStats, localRangeStats, remoteStatsQuery.data]);

  const error = useMemo(() => {
    if (recordsQuery.error) {
      return getErrorMessage(recordsQuery.error, 'Error loading records');
    }

    if (remoteStatsQuery.isError && !localFallbackStats) {
      return getErrorMessage(remoteStatsQuery.error, 'Error loading remote statistics');
    }

    return null;
  }, [recordsQuery.error, remoteStatsQuery.isError, remoteStatsQuery.error, localFallbackStats]);

  const comparison = useMemo<MinsalComparisonSummary | null>(() => {
    if (!stats) {
      return null;
    }

    return buildMinsalComparisonSummary(stats, previousLocalStats);
  }, [previousLocalStats, stats]);

  const dataQualityIssues = useMemo(
    () => buildAnalyticsDataQualityIssues(currentRangeRecords, effectiveCalculationOptions),
    [currentRangeRecords, effectiveCalculationOptions]
  );

  const setPreset = useCallback(
    (preset: DateRangePreset) => {
      if (preset === 'currentMonth') {
        setDateRange({
          preset,
          currentYearMonth: new Date().getMonth() + 1,
        });
        return;
      }
      setDateRange({ preset });
    },
    [setDateRange]
  );

  const setCustomRange = useCallback(
    (start: string, end: string) => {
      setDateRange({
        preset: 'custom',
        startDate: start,
        endDate: end,
      });
    },
    [setDateRange]
  );

  const setCurrentYearMonth = useCallback(
    (month: number) => {
      setDateRange({
        preset: 'currentMonth',
        currentYearMonth: month,
      });
    },
    [setDateRange]
  );

  const refresh = useCallback(async () => {
    // A manual refresh always asks the server again.
    lastRemoteRangeSyncRef.current.delete(`${previousPeriodStart}:${endDate}`);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: localRecordsQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: remoteStatsQueryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: reclassificationsQueryKey,
      }),
    ]);
  }, [
    queryClient,
    localRecordsQueryKey,
    remoteStatsQueryKey,
    reclassificationsQueryKey,
    previousPeriodStart,
    endDate,
  ]);

  return {
    stats,
    trendData,
    allRecords: currentRangeRecords,
    dateRange,
    setPreset,
    setCustomRange,
    setCurrentYearMonth,
    isLoading:
      recordsQuery.isLoading ||
      reclassificationsQuery.isLoading ||
      (remoteStatsQuery.isLoading && !localFallbackStats),
    error,
    refresh,
    comparison,
    dataQualityIssues,
    reclassifications,
    saveReclassification: saveReclassificationMutation.mutateAsync,
    isSavingReclassification: saveReclassificationMutation.isPending,
  };
}

export default useMinsalStats;
