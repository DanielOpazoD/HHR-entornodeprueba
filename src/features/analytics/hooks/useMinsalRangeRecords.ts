import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import { filterRecordsByDateRange } from '@/features/analytics/services/minsalStatsCalculator';
import { resolveSafeMinsalDateRange } from '@/features/analytics/controllers/minsalStatsVerificationController';
import { loadMinsalRangeRecords } from '@/features/analytics/controllers/minsalStatsQueryController';
import { resolvePreviousMinsalPeriod } from '@/features/analytics/services/minsal/minsalStatsInsights';
import type { DateRangeConfig, DateRangePreset } from '@/features/analytics/types/minsalTypes';
import type { DailyRecordMovementState as DailyRecord } from '@/types/domain/dailyRecordSlices';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
  isDailyRecordStoreChangeRelevantToRange,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { getTodayISO } from '@/utils/dateCoreUtils';

export interface UseMinsalRangeRecordsResult {
  dateRange: DateRangeConfig;
  startDate: string;
  endDate: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  localRecordsQueryKey: ReturnType<typeof queryKeys.analytics.recordsRange>;
  currentRangeRecords: DailyRecord[];
  previousRangeRecords: DailyRecord[];
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  setPreset: (preset: DateRangePreset) => void;
  setCustomRange: (startDate: string, endDate: string) => void;
  setCurrentYearMonth: (month: number) => void;
  clearRemoteRangeSyncWindow: () => void;
}

export const useMinsalRangeRecords = (
  initialPreset: DateRangePreset
): UseMinsalRangeRecordsResult => {
  const queryClient = useQueryClient();
  const lastRemoteRangeSyncRef = useRef(new Map<string, number>());
  const [dateRange, setDateRange] = useState<DateRangeConfig>({ preset: initialPreset });

  const { startDate, endDate } = useMemo(() => resolveSafeMinsalDateRange(dateRange), [dateRange]);
  const { previousPeriodStart, previousPeriodEnd } = useMemo(
    () => resolvePreviousMinsalPeriod(startDate, endDate),
    [startDate, endDate]
  );

  const localRecordsQueryKey = useMemo(
    () => queryKeys.analytics.recordsRange(previousPeriodStart, endDate),
    [previousPeriodStart, endDate]
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
    queryFn: () =>
      loadMinsalRangeRecords({
        previousPeriodStart,
        endDate,
        lastRemoteRangeSyncByKey: lastRemoteRangeSyncRef.current,
      }),
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
  const previousRangeRecords = useMemo(
    () => filterRecordsByDateRange(rangeRecords, previousPeriodStart, previousPeriodEnd),
    [rangeRecords, previousPeriodEnd, previousPeriodStart]
  );

  const setPreset = useCallback((preset: DateRangePreset) => {
    if (preset === 'currentMonth') {
      setDateRange({
        preset,
        currentYearMonth: Number(getTodayISO().slice(5, 7)),
      });
      return;
    }
    setDateRange({ preset });
  }, []);

  const setCustomRange = useCallback((start: string, end: string) => {
    setDateRange({ preset: 'custom', startDate: start, endDate: end });
  }, []);

  const setCurrentYearMonth = useCallback((month: number) => {
    setDateRange({ preset: 'currentMonth', currentYearMonth: month });
  }, []);

  const clearRemoteRangeSyncWindow = useCallback(() => {
    lastRemoteRangeSyncRef.current.delete(`${previousPeriodStart}:${endDate}`);
  }, [previousPeriodStart, endDate]);

  return {
    dateRange,
    startDate,
    endDate,
    previousPeriodStart,
    previousPeriodEnd,
    localRecordsQueryKey,
    currentRangeRecords,
    previousRangeRecords,
    isLoading: recordsQuery.isLoading,
    isError: recordsQuery.isError,
    isSuccess: recordsQuery.isSuccess,
    error: recordsQuery.error,
    setPreset,
    setCustomRange,
    setCurrentYearMonth,
    clearRemoteRangeSyncWindow,
  };
};
