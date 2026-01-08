/**
 * useExistingDaysQuery Hook
 * Replaces the legacy useExistingDays hook with TanStack Query.
 * Resolves race conditions when changing months and provides a centralized cache.
 */

import { useQuery } from '@tanstack/react-query';
import { getRecordsForMonth } from '../services/storage/indexedDBService';
import { DailyRecord, PatientData } from '../types';

/**
 * Hook to calculate which days in the selected month have patient data.
 * @param selectedYear - The year selected in navigation
 * @param selectedMonth - The month selected in navigation (0-indexed)
 */
export const useExistingDaysQuery = (selectedYear: number, selectedMonth: number) => {
    return useQuery({
        queryKey: ['existingDays', selectedYear, selectedMonth],
        queryFn: async () => {
            console.log(`[useExistingDaysQuery] 🔍 Fetching existing days for ${selectedYear}-${selectedMonth + 1}...`);

            // selectedMonth is 0-indexed in JS (0=Jan), but our records use 1-indexed strings (01=Jan)
            const records = await getRecordsForMonth(selectedYear, selectedMonth + 1);

            const days = records
                .filter(dayRecord => {
                    if (!dayRecord || !dayRecord.beds) return false;

                    // Check if day has any patients
                    return Object.values(dayRecord.beds).some((bed) =>
                        (bed as PatientData).patientName && (bed as PatientData).patientName.trim() !== ''
                    );
                })
                .map(d => parseInt(d.date.split('-')[2]));

            return days;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes (invalidated when record is saved)
    });
};
