/**
 * useMinsalStats Hook
 * React hook for MINSAL/DEIS hospital statistics
 * Provides filtering, calculation, and trend data for the analytics view
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAllRecords } from '@/services/storage/indexedDBService';
import {
    calculateMinsalStats as calculateMinsalStatsLocal,
    generateDailyTrend,
    getDateRangeFromPreset,
    filterRecordsByDateRange,
} from '@/services/calculations/minsalStatsCalculator';
import { functions } from '@/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { getRecordsRangeFromFirestore } from '@/services/storage/firestoreService';
import { saveRecord as saveToIndexedDB } from '@/services/storage/indexedDBService';
import {
    MinsalStatistics,
    DailyStatsSnapshot,
    DateRangePreset,
    DateRangeConfig,
} from '@/types/minsalTypes';
import { DailyRecord } from '@/types';

interface UseMinsalStatsResult {
    /** Calculated MINSAL statistics */
    stats: MinsalStatistics | null;
    /** Daily trend data for charts */
    trendData: DailyStatsSnapshot[];
    /** All loaded records */
    allRecords: DailyRecord[];
    /** Current date range configuration */
    dateRange: DateRangeConfig;
    /** Update the date range preset */
    setPreset: (preset: DateRangePreset) => void;
    /** Update custom date range */
    setCustomRange: (startDate: string, endDate: string) => void;
    /** Loading state */
    isLoading: boolean;
    /** Error message if any */
    error: string | null;
    /** Refresh data */
    refresh: () => Promise<void>;
}

/**
 * Hook for MINSAL/DEIS statistics
 * @param initialPreset - Initial date range preset (default: 'lastMonth')
 */
export function useMinsalStats(
    initialPreset: DateRangePreset = 'lastMonth'
): UseMinsalStatsResult {
    const [allRecords, setAllRecords] = useState<DailyRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<DateRangeConfig>({
        preset: initialPreset,
    });

    // Load all records from IndexedDB
    const loadRecords = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const recordsMap = await getAllRecords();
            const recordsList = Object.values(recordsMap).sort((a, b) =>
                b.date.localeCompare(a.date)
            );
            setAllRecords(recordsList);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error loading records';
            setError(message);
            console.error('[useMinsalStats] Error loading records:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Proactive sync logic: Fetch from Firestore if local is empty for the range
    const syncFirestoreRange = useCallback(async (start: string, end: string) => {
        try {
            // console.info(`[useMinsalStats] Proactive Sync: Fetching range ${start} to ${end} from Firestore...`);
            const remoteRecords = await getRecordsRangeFromFirestore(start, end);

            if (remoteRecords.length > 0) {
                // Save to IndexedDB for future fast access
                for (const record of remoteRecords) {
                    await saveToIndexedDB(record);
                }
                // Update local state
                setAllRecords(prev => {
                    const next = [...prev];
                    remoteRecords.forEach(remote => {
                        if (!next.find(l => l.date === remote.date)) {
                            next.push(remote);
                        }
                    });
                    return next.sort((a, b) => b.date.localeCompare(a.date));
                });
            }
        } catch (err) {
            console.warn('[useMinsalStats] Proactive sync failed:', err);
        }
    }, []);

    // Load on mount
    useEffect(() => {
        loadRecords();
    }, [loadRecords]);

    // State for Cloud Function results
    const [remoteStats, setRemoteStats] = useState<MinsalStatistics | null>(null);
    const [isRemoteLoading, setIsRemoteLoading] = useState(false);

    // Calculate date range
    const { startDate, endDate } = useMemo(() => {
        try {
            return getDateRangeFromPreset(
                dateRange.preset,
                dateRange.startDate,
                dateRange.endDate
            );
        } catch {
            const today = new Date().toISOString().split('T')[0];
            return { startDate: today, endDate: today };
        }
    }, [dateRange]);

    // Trigger proactive sync when range changes
    useEffect(() => {
        if (!isLoading) {
            // If local records for this range are few, try sync
            const localInRange = filterRecordsByDateRange(allRecords, startDate, endDate);
            if (localInRange.length === 0) {
                syncFirestoreRange(startDate, endDate);
            }
        }
    }, [startDate, endDate, isLoading, allRecords.length, syncFirestoreRange]);

    // Remote Calculation Effect
    useEffect(() => {
        const fetchRemoteStats = async () => {
            if (!functions) return;

            setIsRemoteLoading(true);
            try {
                const calculateStats = httpsCallable(functions, 'calculateMinsalStats');
                const result = await calculateStats({
                    hospitalId: getActiveHospitalId(),
                    startDate,
                    endDate
                });
                setRemoteStats(result.data as MinsalStatistics);
            } catch (err) {
                console.warn('[useMinsalStats] Remote calculation failed, using local fallback:', err);
                setRemoteStats(null); // Force local fallback
            } finally {
                setIsRemoteLoading(false);
            }
        };

        fetchRemoteStats();
    }, [startDate, endDate]);

    // Calculate MINSAL statistics (Local Fallback)
    const localStats = useMemo(() => {
        if (allRecords.length === 0) return null;
        return calculateMinsalStatsLocal(allRecords, startDate, endDate);
    }, [allRecords, startDate, endDate]);

    // Final Stats: Remote if available (and complete), otherwise local
    const stats = useMemo(() => {
        // If remoteStats exists but is missing porEspecialidad (old CF version), 
        // prefer localStats if it has data.
        if (remoteStats && (!remoteStats.porEspecialidad || remoteStats.porEspecialidad.length === 0)) {
            if (localStats && localStats.porEspecialidad && localStats.porEspecialidad.length > 0) {
                return localStats;
            }
        }
        return remoteStats || localStats;
    }, [remoteStats, localStats]);

    // Generate trend data
    const trendData = useMemo(() => {
        if (allRecords.length === 0) return [];
        const filtered = filterRecordsByDateRange(allRecords, startDate, endDate);
        return generateDailyTrend(filtered);
    }, [allRecords, startDate, endDate]);

    // Preset setter
    const setPreset = useCallback((preset: DateRangePreset) => {
        setDateRange({ preset });
    }, []);

    // Custom range setter
    const setCustomRange = useCallback((start: string, end: string) => {
        setDateRange({
            preset: 'custom',
            startDate: start,
            endDate: end,
        });
    }, []);

    return {
        stats,
        trendData,
        allRecords,
        dateRange,
        setPreset,
        setCustomRange,
        isLoading: isLoading || isRemoteLoading,
        error,
        refresh: loadRecords,
    };
}

export default useMinsalStats;
