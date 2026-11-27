/**
 * useMinsalStats Hook
 * React hook for MINSAL/DEIS hospital statistics with range-based loading.
 */

import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import type { SaveAnalyticsSpecialtyReclassificationRequest } from '@/features/analytics/services/analyticsSpecialtyReclassificationService';
import {
  calculateMinsalStats as calculateMinsalStatsLocal,
  generateDailyTrend,
} from '@/features/analytics/services/minsalStatsCalculator';
import { resolveDisplayedMinsalStats } from '@/features/analytics/controllers/minsalAnalyticsPresentationController';
import {
  isRemoteStatsQueryVerified,
  isRemoteStatsSnapshotStale,
  resolveMinsalDisplayError,
  resolveRemoteStatsWarning,
} from '@/features/analytics/controllers/minsalStatsVerificationController';
import { fetchRemoteMinsalStatsSnapshot } from '@/features/analytics/controllers/minsalStatsQueryController';
import {
  buildAnalyticsDataQualityIssues,
  buildMinsalComparisonSummary,
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
import { useMinsalRangeRecords } from './useMinsalRangeRecords';
import { useMinsalSpecialtyReclassifications } from './useMinsalSpecialtyReclassifications';

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
  const manualRefreshKeysRef = useRef(new Set<string>());
  const safeRemoteOptions = useMemo(
    () => ({
      specialtyGroupingMode: calculationOptions.specialtyGroupingMode,
    }),
    [calculationOptions.specialtyGroupingMode]
  );

  const {
    dateRange,
    startDate,
    endDate,
    previousPeriodStart,
    previousPeriodEnd,
    localRecordsQueryKey,
    currentRangeRecords,
    previousRangeRecords,
    isLoading: isRangeRecordsLoading,
    isError: isRangeRecordsError,
    isSuccess: isRangeRecordsSuccess,
    error: rangeRecordsError,
    setPreset,
    setCustomRange,
    setCurrentYearMonth,
    clearRemoteRangeSyncWindow,
  } = useMinsalRangeRecords(initialPreset);

  const {
    reclassificationsQueryKey,
    saveReclassificationMutationKey,
    isLoading: isReclassificationsLoading,
    allPeriodReclassifications,
    reclassifications,
    reclassificationsError,
    isReclassificationsVerified,
    currentVerifiedStamp,
    hasReclassificationsSettledOnce,
    saveReclassification,
    isSavingReclassification,
  } = useMinsalSpecialtyReclassifications({
    hospitalId,
    startDate,
    endDate,
    previousPeriodStart,
    manualRefreshKeysRef,
  });

  const remoteStatsQueryKey = useMemo(
    () =>
      [
        ...queryKeys.analytics.remoteStats(hospitalId, startDate, endDate),
        JSON.stringify(safeRemoteOptions),
      ] as const,
    [hospitalId, startDate, endDate, safeRemoteOptions]
  );

  const shouldUseRemoteStats =
    isRangeRecordsError || (isRangeRecordsSuccess && currentRangeRecords.length === 0);

  const remoteStatsQuery = useQuery({
    queryKey: remoteStatsQueryKey,
    // The screen shows the local stats whenever this range has local records (see
    // resolveDisplayedMinsalStats), so the server calculation, which reads every day of the
    // range, only runs when it is the one shown: no local records, or the local read failed.
    // Waiting once for the initial reclassification read avoids fetching an unverified aggregate
    // while keeping the query key and enabled flag stable across retries and refreshes.
    enabled: shouldUseRemoteStats && hasReclassificationsSettledOnce,
    queryFn: () =>
      fetchRemoteMinsalStatsSnapshot({
        queryClient,
        reclassificationsQueryKey,
        saveReclassificationMutationKey,
        hospitalId,
        startDate,
        endDate,
        safeRemoteOptions,
      }),
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

  const trendData = useMemo(
    () => (currentRangeRecords.length === 0 ? [] : generateDailyTrend(currentRangeRecords)),
    [currentRangeRecords]
  );

  const localRangeStats = useMemo(
    () =>
      currentRangeRecords.length === 0
        ? null
        : calculateMinsalStatsLocal(
            currentRangeRecords,
            startDate,
            endDate,
            effectiveCalculationOptions
          ),
    [currentRangeRecords, startDate, endDate, effectiveCalculationOptions]
  );

  const previousLocalStats = useMemo(
    () =>
      previousRangeRecords.length === 0
        ? null
        : calculateMinsalStatsLocal(
            previousRangeRecords,
            previousPeriodStart,
            previousPeriodEnd,
            effectiveCalculationOptions
          ),
    [effectiveCalculationOptions, previousPeriodEnd, previousPeriodStart, previousRangeRecords]
  );

  const localFallbackStats = remoteStatsQuery.isError ? localRangeStats : null;
  const remoteStats = remoteStatsQuery.data?.stats ?? null;

  const stats = useMemo<MinsalStatistics | null>(
    () =>
      resolveDisplayedMinsalStats({
        localStats: localRangeStats,
        remoteStats: remoteStats ?? localFallbackStats,
      }),
    [localFallbackStats, localRangeStats, remoteStats]
  );

  const error = useMemo(
    () =>
      resolveMinsalDisplayError({
        recordsError: rangeRecordsError,
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
      rangeRecordsError,
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
  const isRemoteStatsStampStale = isRemoteStatsSnapshotStale({
    isUsingRemoteStats,
    currentVerifiedStamp,
    snapshot: remoteStatsQuery.data,
  });

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

  const isRemoteStatsVerified = isRemoteStatsQueryVerified({
    isUsingRemoteStats,
    status: remoteStatsQuery.status,
    error: remoteStatsQuery.error,
    isFetching: remoteStatsQuery.isFetching,
    isPaused: remoteStatsQuery.isPaused,
    isStampStale: isRemoteStatsStampStale,
    failureCount: remoteStatsQuery.failureCount,
  });
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

  const comparison = useMemo<MinsalComparisonSummary | null>(
    () => (stats ? buildMinsalComparisonSummary(stats, previousLocalStats) : null),
    [previousLocalStats, stats]
  );

  const dataQualityIssues = useMemo(
    () => buildAnalyticsDataQualityIssues(currentRangeRecords, effectiveCalculationOptions),
    [currentRangeRecords, effectiveCalculationOptions]
  );

  const refresh = useCallback(async () => {
    // A manual refresh always asks the server again.
    clearRemoteRangeSyncWindow();
    manualRefreshKeysRef.current.add(remoteStatsKeyHash);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: localRecordsQueryKey }),
        queryClient.invalidateQueries({ queryKey: reclassificationsQueryKey }),
      ]);
      await queryClient.invalidateQueries({ queryKey: remoteStatsQueryKey, exact: true });
    } finally {
      manualRefreshKeysRef.current.delete(remoteStatsKeyHash);
    }
  }, [
    clearRemoteRangeSyncWindow,
    queryClient,
    localRecordsQueryKey,
    remoteStatsKeyHash,
    remoteStatsQueryKey,
    reclassificationsQueryKey,
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
      isRangeRecordsLoading ||
      isReclassificationsLoading ||
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
    saveReclassification,
    isSavingReclassification,
  };
}

export default useMinsalStats;
