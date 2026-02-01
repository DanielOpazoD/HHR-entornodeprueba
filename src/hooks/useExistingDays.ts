import { useState, useEffect } from 'react';
import { DailyRecord, PatientData } from '@/types';
import { fetchRecordsForMonth } from '@/services/records/recordQueryService';

/**
 * Hook to calculate which days in the selected month have patient data
 * Separated from useDateNavigation for cleaner dependency management
 */
export const useExistingDays = (
    selectedYear: number,
    selectedMonth: number,
    record: DailyRecord | null
): number[] => {
    const [existingDays, setExistingDays] = useState<number[]>([]);

    useEffect(() => {
        let isMounted = true;

        const fetchExistingDays = async () => {
            try {
                // selectedMonth is 0-indexed in JS (0=Jan), but our records use 1-indexed strings (01=Jan)
                const records = await fetchRecordsForMonth(selectedYear, selectedMonth + 1);

                if (!isMounted) return;

                const days = records
                    .filter(dayRecord => {
                        if (!dayRecord || !dayRecord.beds) return false;

                        // Check if day has any patients
                        return Object.values(dayRecord.beds).some((bed) =>
                            (bed as PatientData).patientName && (bed as PatientData).patientName.trim() !== ''
                        );
                    })
                    .map(d => parseInt(d.date.split('-')[2]));

                setExistingDays(days);
            } catch (error) {
                console.error('Error fetching existing days:', error);
            }
        };

        fetchExistingDays();

        return () => {
            isMounted = false;
        };
    }, [selectedYear, selectedMonth, record]); // Re-calculate when month or current record changes

    return existingDays;
};
