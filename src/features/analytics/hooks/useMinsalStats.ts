/**
 * useMinsalStats Hook
 * React hook for MINSAL/DEIS hospital statistics with range-based loading.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import { fetchRecordsRangeSorted, syncRecordsRange } from '@/services/records/recordQueryService';
import {
  fetchAnalyticsSpecialtyReclassifications,
  saveAnalyticsSpecialtyReclassification,
  type SaveAnalyticsSpecialtyReclassificationRequest,
} from '@/features/analytics/services/analyticsSpecialtyReclassificationService';
import {
  calculateMinsalStats as calculateMinsalStatsLocal,
  filterRecordsByDateRange,
  generateDailyTrend,
  getDateRangeFromPreset,
} from '@/features/analytics/services/minsalStatsCalculator';
import { resolveDisplayedMinsalStats } from '@/features/analytics/controllers/minsalAnalyticsPresentationController';
import {
  buildVerifiedReclassificationsStamp,
  filterReclassificationsForRange,
  getCalendarDaysInRange,
  mergeRecordsByDateDesc,
  REMOTE_RANGE_SYNC_INTERVAL_MS,
  resolveMinsalDisplayError,
  resolveReclassificationsError,
  resolveRemoteStatsWarning,
  type RemoteStatsSnapshot,
} from '@/features/analytics/controllers/minsalStatsVerificationController';
import {
  buildAnalyticsDataQualityIssues,
  buildMinsalComparisonSummary,
  resolvePreviousMinsalPeriod,
} from '@/features/analytics/services/minsal/minsalStatsInsights';
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
} from '@/features/analytics/types/minsalTypes';
import type { DailyRecordMovementState as DailyRecord } from '@/types/domain/dailyRecordSlices';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
  isDailyRecordStoreChangeRelevantToRange,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { getTodayISO } from '@/utils/dateCoreUtils';

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
  reclassificationsError: string | null;
  remoteStatsWarning: string | null;
  isReclassificationsVerified: boolean;
  canExportExcel: boolean;
  saveReclassification: (
    request: Omit<SaveAnalyticsSpecialtyReclassificationRequest, 'hospitalId'>
  ) => Promise<void>;
  isSavingReclassification: boolean;
}

export function useMinsalStats(
  initialPreset: DateRangePreset = 'lastMonth',
  calculationOptions: MinsalCalculationOptions = {}
): UseMinsalStatsResult {
  const queryClient = useQueryClient();
  const hospitalId = getActiveHospitalId();
  const lastRemoteRangeSyncRef = useRef(new Map<string, number>());
  const manualRefreshKeysRef = useRef(new Set<string>());
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
      const expectedDays = getCalendarDaysInRange(previousPeriodStart, endDate);

      if (localRecords.length >= expectedDays) {
        return localRecords;
      }

      const rangeKey = `${previousPeriodStart}:${endDate}`;
      const lastSyncAt = lastRemoteRangeSyncRef.current.get(rangeKey);
      if (lastSyncAt !== undefined && Date.now() - lastSyncAt < REMOTE_RANGE_SYNC_INTERVAL_MS) {
        return localRecords;
      }
      lastRemoteRangeSyncRef.current.set(rangeKey, Date.now());
      try {
        const syncedRecords = await syncRecordsRange(previousPeriodStart, endDate);
        if (syncedRecords.length === 0) {
          return localRecords;
        }

        return mergeRecordsByDateDesc(localRecords, syncedRecords);
      } catch (error) {
        // A failed attempt must not make a retry accept the local range as a completed sync.
        lastRemoteRangeSyncRef.current.delete(rangeKey);
        throw error;
      }
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

  const reclassificationsQuery = useQuery({
    queryKey: reclassificationsQueryKey,
    queryFn: () =>
      fetchAnalyticsSpecialtyReclassifications(previousPeriodStart, endDate, hospitalId),
    staleTime: 2 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });

  const saveReclassificationMutationKey = useMemo(
    () => queryKeys.analytics.saveSpecialtyReclassification(hospitalId),
    [hospitalId]
  );
  const pendingReclassificationSaves = useIsMutating({
    mutationKey: saveReclassificationMutationKey,
  });

  const saveReclassificationMutation = useMutation({
    mutationKey: saveReclassificationMutationKey,
    mutationFn: (request: Omit<SaveAnalyticsSpecialtyReclassificationRequest, 'hospitalId'>) =>
      saveAnalyticsSpecialtyReclassification({ ...request, hospitalId }),
    onSettled: async () => {
      const reclassificationsPrefix =
        queryKeys.analytics.specialtyReclassificationsByHospital(hospitalId);
      const remoteStatsPrefix = queryKeys.analytics.remoteStatsByHospital(hospitalId);

      manualRefreshKeysRef.current.add('*');
      try {
        await Promise.all([
          queryClient.cancelQueries({ queryKey: reclassificationsPrefix }),
          queryClient.cancelQueries({ queryKey: remoteStatsPrefix }),
        ]);
        await queryClient.invalidateQueries(
          { queryKey: reclassificationsPrefix },
          { cancelRefetch: true }
        );
        await queryClient.invalidateQueries(
          { queryKey: remoteStatsPrefix },
          { cancelRefetch: true }
        );
      } finally {
        manualRefreshKeysRef.current.delete('*');
      }
    },
  });

  const isSavingReclassification =
    saveReclassificationMutation.isPending || pendingReclassificationSaves > 0;
  const reclassificationsQueryState = queryClient.getQueryState(reclassificationsQueryKey);
  const isReclassificationsInvalidated = reclassificationsQueryState?.isInvalidated ?? false;
  const reclassificationsUpdateCount = reclassificationsQueryState?.dataUpdateCount ?? 0;
  const reclassificationsErrorCount = reclassificationsQueryState?.errorUpdateCount ?? 0;

  const previousRangeRecords = useMemo(
    () => filterRecordsByDateRange(rangeRecords, previousPeriodStart, previousPeriodEnd),
    [rangeRecords, previousPeriodEnd, previousPeriodStart]
  );
  const allPeriodReclassifications = useMemo(
    () => reclassificationsQuery.data ?? [],
    [reclassificationsQuery.data]
  );
  const reclassifications = useMemo(
    () => filterReclassificationsForRange(allPeriodReclassifications, startDate, endDate),
    [allPeriodReclassifications, endDate, startDate]
  );

  const reclassificationsError = useMemo(
    () =>
      resolveReclassificationsError(reclassificationsQuery.error, reclassificationsQuery.isPaused),
    [reclassificationsQuery.error, reclassificationsQuery.isPaused]
  );

  const isReclassificationsVerified =
    reclassificationsQuery.status === 'success' &&
    !reclassificationsQuery.error &&
    !reclassificationsQuery.isFetching &&
    !reclassificationsQuery.isPaused &&
    !isReclassificationsInvalidated &&
    reclassificationsQuery.failureCount === 0 &&
    !isSavingReclassification;

  const currentVerifiedStamp = useMemo(
    () =>
      isReclassificationsVerified && reclassificationsUpdateCount > 0
        ? buildVerifiedReclassificationsStamp(
            reclassificationsUpdateCount,
            reclassificationsQuery.dataUpdatedAt,
            reclassifications
          )
        : null,
    [
      isReclassificationsVerified,
      reclassifications,
      reclassificationsQuery.dataUpdatedAt,
      reclassificationsUpdateCount,
    ]
  );

  const remoteStatsQueryKey = useMemo(
    () =>
      [
        ...queryKeys.analytics.remoteStats(hospitalId, startDate, endDate),
        JSON.stringify(safeRemoteOptions),
      ] as const,
    [hospitalId, startDate, endDate, safeRemoteOptions]
  );

  const shouldUseRemoteStats =
    recordsQuery.isError || (recordsQuery.isSuccess && currentRangeRecords.length === 0);
  const hasReclassificationsSettledOnce =
    reclassificationsUpdateCount > 0 ||
    reclassificationsErrorCount > 0 ||
    reclassificationsQuery.isPaused;

  const remoteStatsQuery = useQuery({
    queryKey: remoteStatsQueryKey,
    // The screen shows the local stats whenever this range has local records (see
    // resolveDisplayedMinsalStats), so the server calculation, which reads every day of the
    // range, only runs when it is the one shown: no local records, or the local read failed.
    // Waiting once for the initial reclassification read avoids fetching an unverified aggregate
    // while keeping the query key and enabled flag stable across retries and refreshes.
    enabled: shouldUseRemoteStats && hasReclassificationsSettledOnce,
    queryFn: async (): Promise<RemoteStatsSnapshot> => {
      const reclassState =
        queryClient.getQueryState<SpecialtyReclassification[]>(reclassificationsQueryKey);
      const isPendingSave =
        queryClient.isMutating({ mutationKey: saveReclassificationMutationKey }) > 0;
      const reclassificationsStamp =
        !isPendingSave &&
        reclassState &&
        reclassState.status === 'success' &&
        !reclassState.error &&
        !reclassState.isInvalidated &&
        reclassState.dataUpdateCount > 0
          ? buildVerifiedReclassificationsStamp(
              reclassState.dataUpdateCount,
              reclassState.dataUpdatedAt,
              filterReclassificationsForRange(reclassState.data ?? [], startDate, endDate)
            )
          : null;
      const functions = await defaultFunctionsRuntime.getFunctions();
      const { httpsCallable } = await import('firebase/functions');
      const calculateStats = httpsCallable(functions, 'calculateMinsalStats');
      const result = await calculateStats({
        hospitalId,
        startDate,
        endDate,
        options: safeRemoteOptions,
      });
      return {
        stats: result.data as MinsalStatistics,
        reclassificationsStamp,
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
  });

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

  const remoteStats = remoteStatsQuery.data?.stats ?? null;

  const stats = useMemo<MinsalStatistics | null>(() => {
    return resolveDisplayedMinsalStats({
      localStats: localRangeStats,
      remoteStats: remoteStats ?? localFallbackStats,
    });
  }, [localFallbackStats, localRangeStats, remoteStats]);

  const error = useMemo(
    () =>
      resolveMinsalDisplayError({
        recordsError: recordsQuery.error,
        remoteStatsIsError: remoteStatsQuery.isError,
        remoteStatsError: remoteStatsQuery.error,
        hasLocalFallbackStats: Boolean(localFallbackStats),
        hasRemoteStats: Boolean(remoteStats),
        shouldUseRemoteStats,
        remoteStatsIsPaused: remoteStatsQuery.isPaused,
        hasVisibleStats: Boolean(stats),
        reclassificationsError,
      }),
    [
      recordsQuery.error,
      remoteStatsQuery.isError,
      remoteStatsQuery.error,
      remoteStatsQuery.isPaused,
      localFallbackStats,
      remoteStats,
      shouldUseRemoteStats,
      stats,
      reclassificationsError,
    ]
  );

  const isUsingRemoteStats = !localRangeStats && shouldUseRemoteStats;
  const isRemoteStatsStampStale =
    isUsingRemoteStats &&
    currentVerifiedStamp !== null &&
    Boolean(remoteStatsQuery.data) &&
    remoteStatsQuery.data?.reclassificationsStamp !== currentVerifiedStamp;

  const remoteStatsKeyHash = useMemo(
    () => JSON.stringify(remoteStatsQueryKey),
    [remoteStatsQueryKey]
  );

  useEffect(() => {
    if (
      !isRemoteStatsStampStale ||
      manualRefreshKeysRef.current.has('*') ||
      manualRefreshKeysRef.current.has(remoteStatsKeyHash) ||
      remoteStatsQuery.isFetching ||
      remoteStatsQuery.isPaused ||
      remoteStatsQuery.error
    ) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: remoteStatsQueryKey,
      exact: true,
    });
  }, [
    isRemoteStatsStampStale,
    queryClient,
    remoteStatsKeyHash,
    remoteStatsQuery.error,
    remoteStatsQuery.isFetching,
    remoteStatsQuery.isPaused,
    remoteStatsQueryKey,
  ]);

  const isRemoteStatsVerified =
    !isUsingRemoteStats ||
    (remoteStatsQuery.status === 'success' &&
      !remoteStatsQuery.error &&
      !remoteStatsQuery.isFetching &&
      !remoteStatsQuery.isPaused &&
      !isRemoteStatsStampStale &&
      remoteStatsQuery.failureCount === 0);
  const remoteStatsWarning = useMemo(
    () =>
      resolveRemoteStatsWarning({
        isUsingRemoteStats,
        hasVisibleStats: Boolean(stats),
        error: remoteStatsQuery.error,
        isPaused: remoteStatsQuery.isPaused,
      }),
    [isUsingRemoteStats, remoteStatsQuery.error, remoteStatsQuery.isPaused, stats]
  );
  const canExportExcel = Boolean(stats) && isReclassificationsVerified && isRemoteStatsVerified;

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
          currentYearMonth: Number(getTodayISO().slice(5, 7)),
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
    manualRefreshKeysRef.current.add(remoteStatsKeyHash);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: localRecordsQueryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: reclassificationsQueryKey,
        }),
      ]);
      await queryClient.invalidateQueries({
        queryKey: remoteStatsQueryKey,
        exact: true,
      });
    } finally {
      manualRefreshKeysRef.current.delete(remoteStatsKeyHash);
    }
  }, [
    queryClient,
    localRecordsQueryKey,
    remoteStatsKeyHash,
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
    reclassificationsError,
    remoteStatsWarning,
    isReclassificationsVerified,
    canExportExcel,
    saveReclassification: saveReclassificationMutation.mutateAsync,
    isSavingReclassification,
  };
}

export default useMinsalStats;
