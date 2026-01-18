import React, { useMemo } from 'react';
import { useDailyRecordData, useDailyRecordActions } from '../context/DailyRecordContext';
import { useStaffContext } from '../context/StaffContext';
import { getPreviousDay, getAvailableDates } from '../services/repositories/DailyRecordRepository';
import { calculateStats } from '../services/calculations/statsCalculator';

/**
 * Custom hook to manage the logic for the Census View.
 * Connects the view with DailyRecordContext and StaffContext, 
 * and handles asynchronous checks for previous day availability.
 * 
 * @param currentDateString - The currently selected date in YYYY-MM-DD format.
 */
export const useCensusLogic = (currentDateString: string) => {
    const { record } = useDailyRecordData();
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
        if (!record) return null;
        return calculateStats(record.beds);
    }, [record]);

    return {
        // Data
        record,
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
