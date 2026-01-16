/**
 * MINSAL/DEIS Statistics Types
 * Types for Chilean Ministry of Health hospital statistics
 * Based on DEIS (Departamento de Estadísticas e Información de Salud) standards
 */

import { Specialty } from './core';

/**
 * Date range preset options for statistics filtering
 */
export type DateRangePreset =
    | 'today'
    | 'last7days'
    | 'lastMonth'
    | 'last3Months'
    | 'last6Months'
    | 'last12Months'
    | 'custom';

/**
 * Statistics breakdown by medical specialty
 */
export interface SpecialtyStats {
    /** Medical specialty name */
    specialty: Specialty | string;
    /** Current hospitalized patients in this specialty */
    pacientesActuales: number;
    /** Total discharges in the period */
    egresos: number;
    /** Deaths in the period */
    fallecidos: number;
    /** Transfers in the period */
    traslados: number;
    /** Total occupied bed-days */
    diasOcupados: number;
    /** Relative contribution to total hospitalized (percentage) */
    contribucionRelativa: number;
    /** Mortality rate for this specialty (percentage) */
    tasaMortalidad: number;
    /** Average length of stay in days */
    promedioDiasEstada: number;
}

/**
 * Main MINSAL/DEIS Statistics Interface
 * Contains all required indicators for Chilean hospital reporting
 */
export interface MinsalStatistics {
    // ===== Period Information =====
    /** Start date of the analysis period (ISO string) */
    periodStart: string;
    /** End date of the analysis period (ISO string) */
    periodEnd: string;
    /** Total days with data in the period (actual days analyzed) */
    totalDays: number;
    /** Calendar days in the period range */
    calendarDays?: number;

    // ===== Core MINSAL Indicators =====
    /**
     * Días Cama Disponibles
     * Total bed-days available in the period
     * Formula: Σ (available beds × days in period)
     */
    diasCamaDisponibles: number;

    /**
     * Días Cama Ocupados
     * Total bed-days used by patients
     * Formula: Σ (occupied beds per day)
     */
    diasCamaOcupados: number;

    /**
     * Tasa de Ocupación (Índice Ocupacional)
     * Occupancy rate as percentage
     * Formula: (Días Ocupados / Días Disponibles) × 100
     */
    tasaOcupacion: number;

    /**
     * Promedio Días Estada
     * Average length of stay in days
     * Formula: Días Ocupados / Total Egresos
     */
    promedioDiasEstada: number;

    // ===== Discharge Statistics =====
    /** Total discharges (alive + deceased + transfers) */
    egresosTotal: number;
    /** Discharges alive (home, voluntary, etc.) */
    egresosVivos: number;
    /** Deaths during hospitalization */
    egresosFallecidos: number;
    /** External transfers */
    egresosTraslados: number;

    /**
     * Mortalidad Hospitalaria
     * In-hospital mortality rate as percentage
     * Formula: (Fallecidos / Egresos Totales) × 100
     */
    mortalidadHospitalaria: number;

    /**
     * Índice de Rotación
     * Bed turnover rate
     * Formula: Egresos / Camas Disponibles
     */
    indiceRotacion: number;

    // ===== Current Snapshot =====
    /** Current hospitalized patients */
    pacientesActuales: number;
    /** Current occupied beds */
    camasOcupadas: number;
    /** Current blocked beds */
    camasBloqueadas: number;
    /** Current available beds */
    camasDisponibles: number;

    // ===== Breakdown by Specialty =====
    /** Statistics per medical specialty */
    porEspecialidad: SpecialtyStats[];
}

/**
 * Daily statistics snapshot for trend analysis
 */
export interface DailyStatsSnapshot {
    /** Date (ISO string) */
    date: string;
    /** Occupied beds count */
    ocupadas: number;
    /** Available beds count */
    disponibles: number;
    /** Blocked beds count */
    bloqueadas: number;
    /** Discharges on this day */
    egresos: number;
    /** Deaths on this day */
    fallecidos: number;
    /** Occupancy rate percentage */
    tasaOcupacion: number;
}

/**
 * Configuration for date range selection
 */
export interface DateRangeConfig {
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
}

/**
 * Labels for date range presets (Spanish)
 */
export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
    today: 'Hoy',
    last7days: 'Últimos 7 días',
    lastMonth: 'Último mes',
    last3Months: 'Últimos 3 meses',
    last6Months: 'Últimos 6 meses',
    last12Months: 'Últimos 12 meses',
    custom: 'Personalizado',
};
