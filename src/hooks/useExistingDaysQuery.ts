/**
 * useExistingDaysQuery Hook
 * Replaces the legacy useExistingDays hook with TanStack Query.
 * Resolves race conditions when changing months and provides a centralized cache.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/config/queryClient';
import {
  doStoredDaysHavePatientData,
  fetchExistingDaysInMonth,
} from '@/services/records/recordQueryService';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
  isDailyRecordStoreChangeRelevantToMonth,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';

interface UseExistingDaysQueryOptions {
  enabled?: boolean;
}

/**
 * Hook to calculate which days in the selected month have patient data.
 * @param selectedYear - The year selected in navigation
 * @param selectedMonth - The month selected in navigation (0-indexed)
 */
export const useExistingDaysQuery = (
  selectedYear: number,
  selectedMonth: number,
  options: UseExistingDaysQueryOptions = {}
) => {
  const queryClient = useQueryClient();
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const queryKey = queryKeys.existingDays.byMonth(selectedYear, selectedMonth);
    const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-`;
    const rescanMonth = () => void queryClient.invalidateQueries({ queryKey });
    const handleStoreChanged = (event: Event) => {
      const detail = (event as CustomEvent<DailyRecordStoreChangedEventDetail>).detail;
      if (!isDailyRecordStoreChangeRelevantToMonth(detail, selectedYear, selectedMonth + 1)) {
        return;
      }

      // Saving a day that is already marked can only keep or drop its marker, so only
      // that day is re-read. New days, deletes and clears still rescan the month.
      const marked = queryClient.getQueryData<number[]>(queryKey);
      const savedDates =
        detail?.operation === 'save'
          ? (detail.dates ?? []).filter(date => date.startsWith(monthPrefix))
          : [];
      const onlyMarkedDays =
        marked !== undefined &&
        savedDates.length > 0 &&
        savedDates.every(date => marked.includes(parseInt(date.split('-')[2])));
      if (!onlyMarkedDays) {
        rescanMonth();
        return;
      }

      void doStoredDaysHavePatientData(savedDates).then(stillMarked => {
        if (!stillMarked) rescanMonth();
      }, rescanMonth);
    };

    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
    return () => window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, handleStoreChanged);
  }, [enabled, queryClient, selectedYear, selectedMonth]);

  return useQuery({
    queryKey: queryKeys.existingDays.byMonth(selectedYear, selectedMonth),
    queryFn: async () => {
      // selectedMonth is 0-indexed in JS (0=Jan), but our records use 1-indexed strings (01=Jan)
      return await fetchExistingDaysInMonth(selectedYear, selectedMonth + 1);
    },
    enabled,
    staleTime: 1000 * 60 * 5,
    // Local data only: every local writer announces its change through the store event,
    // so returning to the tab or reconnecting adds nothing a month rescan would find.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
