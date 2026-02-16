/**
 * useMinsalStats Hook
 * React hook for MINSAL/DEIS hospital statistics
 * Provides filtering, calculation, and trend data for the analytics view
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllRecordsSorted, syncRecordsRange } from '@/services/records/recordQueryService';
import {
  calculateMinsalStats as calculateMinsalStatsLocal,
  generateDailyTrend,
  getDateRangeFromPreset,
  filterRecordsByDateRange,
} from '@/services/calculations/minsalStatsCalculator';
import { functions } from '@/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { getActiveHospitalId } from '@/constants/firestorePaths';
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
  /** Update selected month for current-year month preset */
  setCurrentYearMonth: (month: number) => void;
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
export function useMinsalStats(initialPreset: DateRangePreset = 'lastMonth'): UseMinsalStatsResult {
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
      const recordsList = await fetchAllRecordsSorted();
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
      const remoteRecords = await syncRecordsRange(start, end);

      if (remoteRecords.length > 0) {
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
        dateRange.endDate,
        dateRange.currentYearMonth
      );
    } catch {
      const today = new Date().toISOString().split('T')[0];
      return { startDate: today, endDate: today };
    }
  }, [dateRange]);

  // Helper to calculate days in range
  const getDaysInRange = (start: string, end: string) => {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  // Trigger proactive sync when range changes
  useEffect(() => {
    if (!isLoading) {
      const expectedDays = getDaysInRange(startDate, endDate);
      const localInRange = filterRecordsByDateRange(allRecords, startDate, endDate);

      // If we have fewer records than days in range, sync from Firestore
      if (localInRange.length < expectedDays) {
        syncFirestoreRange(startDate, endDate);
      }
    }
  }, [startDate, endDate, isLoading, allRecords, syncFirestoreRange]);

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
          endDate,
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
    if (!remoteStats) return localStats;
    if (!localStats) return remoteStats;

    // Smart Merge: Prefer remote for historical totals, but local for
    // snapshot metrics and refined calculations if they seem more accurate.
    return {
      ...remoteStats,
      periodStart: remoteStats.periodStart || localStats.periodStart || startDate,
      periodEnd: remoteStats.periodEnd || localStats.periodEnd || endDate,
      totalDays: remoteStats.totalDays || localStats.totalDays || 0,

      // Core indicators with zero fallbacks
      tasaOcupacion: remoteStats.tasaOcupacion ?? localStats.tasaOcupacion ?? 0,
      promedioDiasEstada: remoteStats.promedioDiasEstada ?? localStats.promedioDiasEstada ?? 0,
      egresosTotal: remoteStats.egresosTotal ?? localStats.egresosTotal ?? 0,
      egresosVivos: remoteStats.egresosVivos ?? localStats.egresosVivos ?? 0,
      egresosFallecidos: remoteStats.egresosFallecidos ?? localStats.egresosFallecidos ?? 0,
      egresosTraslados: remoteStats.egresosTraslados ?? localStats.egresosTraslados ?? 0,
      mortalidadHospitalaria:
        remoteStats.mortalidadHospitalaria ?? localStats.mortalidadHospitalaria ?? 0,
      indiceRotacion: remoteStats.indiceRotacion ?? localStats.indiceRotacion ?? 0,
      diasCamaOcupados: remoteStats.diasCamaOcupados ?? localStats.diasCamaOcupados ?? 0,
      diasCamaDisponibles: remoteStats.diasCamaDisponibles ?? localStats.diasCamaDisponibles ?? 0,

      // Prefer local for current state if remote is zero
      pacientesActuales: remoteStats.pacientesActuales || localStats.pacientesActuales || 0,
      camasOcupadas: remoteStats.camasOcupadas || localStats.camasOcupadas || 0,
      camasBloqueadas: remoteStats.camasBloqueadas || localStats.camasBloqueadas || 0,
      camasDisponibles: remoteStats.camasDisponibles || localStats.camasDisponibles || 0,
      camasLibres: (remoteStats as MinsalStatistics).camasLibres || localStats.camasLibres || 0,
      tasaOcupacionActual:
        (remoteStats as MinsalStatistics).tasaOcupacionActual ||
        localStats.tasaOcupacionActual ||
        0,

      // Handle specialty breakdown merging
      // Prefer LOCAL breakdown because it contains the computed Traceability Lists
      // which are not yet available in the Cloud Function response.
      porEspecialidad:
        localStats.porEspecialidad && localStats.porEspecialidad.length > 0
          ? localStats.porEspecialidad
          : remoteStats.porEspecialidad || [],
    } as MinsalStatistics;
  }, [remoteStats, localStats, startDate, endDate]);

  // Generate trend data
  const trendData = useMemo(() => {
    if (allRecords.length === 0) return [];
    const filtered = filterRecordsByDateRange(allRecords, startDate, endDate);
    return generateDailyTrend(filtered);
  }, [allRecords, startDate, endDate]);

  // Preset setter
  const setPreset = useCallback((preset: DateRangePreset) => {
    if (preset === 'currentMonth') {
      setDateRange({
        preset,
        currentYearMonth: new Date().getMonth() + 1,
      });
      return;
    }
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

  const setCurrentYearMonth = useCallback((month: number) => {
    setDateRange({
      preset: 'currentMonth',
      currentYearMonth: month,
    });
  }, []);

  return {
    stats,
    trendData,
    allRecords,
    dateRange,
    setPreset,
    setCustomRange,
    setCurrentYearMonth,
    isLoading: isLoading || isRemoteLoading,
    error,
    refresh: loadRecords,
  };
}

export default useMinsalStats;
