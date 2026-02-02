/**
 * useExistingDaysQuery Hook
 * Replaces the legacy useExistingDays hook with TanStack Query.
 * Resolves race conditions when changing months and provides a centralized cache.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchExistingDaysInMonth } from '@/services/records/recordQueryService';

/**
 * Hook to calculate which days in the selected month have patient data.
 * @param selectedYear - The year selected in navigation
 * @param selectedMonth - The month selected in navigation (0-indexed)
 */
export const useExistingDaysQuery = (selectedYear: number, selectedMonth: number) => {
    return useQuery({
        queryKey: ['existingDays', selectedYear, selectedMonth],
        queryFn: async () => {
            // selectedMonth is 0-indexed in JS (0=Jan), but our records use 1-indexed strings (01=Jan)
            return await fetchExistingDaysInMonth(selectedYear, selectedMonth + 1);
        },
        staleTime: 1000 * 60 * 5, // 5 minutes (invalidated when record is saved)
    });
};
