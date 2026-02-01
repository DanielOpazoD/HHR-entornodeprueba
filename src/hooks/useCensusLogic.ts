import React, { useMemo } from 'react';
import { useDailyRecordActions, useDailyRecordBeds, useDailyRecordMovements, useDailyRecordStaff } from '@/context/DailyRecordContext';
import { useStaffContext } from '@/context/StaffContext';
import { getPreviousDay, getAvailableDates } from '@/services/repositories/DailyRecordRepository';
import { calculateStats } from '@/services/calculations/statsCalculator';

/**
 * Custom hook to manage the logic for the Census View.
 * Connects the view with DailyRecordContext and StaffContext, 
 * and handles asynchronous checks for previous day availability.
 * 
 * @param currentDateString - The currently selected date in YYYY-MM-DD format.
 */
export const useCensusLogic = (currentDateString: string) => {
    const beds = useDailyRecordBeds();
    const movements = useDailyRecordMovements();
    const staff = useDailyRecordStaff();
    const {
        createDay,
        resetDay,
        updateNurse,
        updateTens,
        undoDischarge,
        deleteDischarge,
        undoTransfer,
        deleteTransfer
    } = useDailyRecordActions();

    const { nursesList, tensList } = useStaffContext();

    // previousRecordAvailable state (Async check)
    const [previousRecordAvailable, setPreviousRecordAvailable] = React.useState(false);
    const [previousRecordDate, setPreviousRecordDate] = React.useState<string | undefined>(undefined);
    const [availableDates, setAvailableDates] = React.useState<string[]>([]);

    React.useEffect(() => {
        let mounted = true;
        getPreviousDay(currentDateString).then(prev => {
            if (mounted) {
                setPreviousRecordAvailable(!!prev);
                setPreviousRecordDate(prev?.date);
            }
        });
        getAvailableDates().then(dates => {
            if (mounted) {
                // Filter out the current date and sort
                const filtered = dates.filter(d => d !== currentDateString);
                setAvailableDates(filtered);
            }
        });
        return () => { mounted = false; };
    }, [currentDateString]);

    // Calculate statistics when record changes
    const stats = useMemo(() => {
        if (!beds) return null;
        return calculateStats(beds);
    }, [beds]);

    return {
        // Data
        beds,
        movements,
        staff,
        nursesList,
        tensList,
        stats,
        previousRecordAvailable,
        previousRecordDate,
        availableDates,

        // Actions
        createDay,
        resetDay,
        updateNurse,
        updateTens,
        undoDischarge,
        deleteDischarge,
        undoTransfer,
        deleteTransfer
    };
};
