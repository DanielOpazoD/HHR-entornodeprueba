/**
 * MINSAL/DEIS Statistics Types
 * Types for Chilean Ministry of Health hospital statistics
 * Based on DEIS (Departamento de Estadísticas e Información de Salud) standards
 */

import type { Specialty } from './domain/patientClassification';

/**
 * Date range preset options for statistics filtering
 */
export type DateRangePreset =
  | 'today'
  | 'last7days'
  | 'lastMonth'
  | 'currentMonth'
  | 'yearToDate'
  | 'last3Months'
  | 'last6Months'
  | 'last12Months'
  | 'custom';

/**
 * Traceability info for a specific patient in a statistic
 */
export interface PatientTraceability {
  /** Patient Name */
  name: string;
  /** Patient RUT */
  rut: string;
  /** Main diagnosis/pathology at the time of the event */
  diagnosis?: string;
  /** Date when the event or status was recorded */
  date: string;
  /** Bed name or location */
  bedName?: string;
  /** Patient admission date (for grouping) */
  admissionDate?: string;
  /** Patient discharge/transfer date */
  dischargeDate?: string;
  /** Movement kind when the row comes from an explicit movement list */
  movementKind?: 'discharge' | 'transfer' | 'cma';
  /** Stable movement identifier for statistical reclassification/audit */
  movementId?: string;
  /** Original clinical specialty stored in the source record */
  originalSpecialty?: string;
  /** Specialty used for statistical reporting after grouping/reclassification */
  reportingSpecialty?: string;
  /** Why reportingSpecialty differs or matches the source specialty */
  reportingSpecialtySource?: 'original' | 'grouped' | 'manual';
  /** CMA intervention type when applicable */
  interventionType?: string;
  /** CMA or movement discharge time when applicable */
  eventTime?: string;
}

/**
 * Statistics breakdown by medical specialty
 */
export interface SpecialtyStats {
  /** Medical specialty name */
  specialty: Specialty | string;
  /** Current hospitalized patients in this specialty, based on the latest snapshot in the selected range */
  pacientesActuales: number;
  /** Total discharges in the period */
  egresos: number;
  /** Deaths in the period */
  fallecidos: number;
  /** Transfers in the period */
  traslados: number;
  /** Transfers in the period via Aerocardal */
  aerocardal: number;
  /** Transfers in the period via FACH */
  fach: number;
  /** Total occupied bed-days accumulated across the selected period using main-bed occupancy */
  diasOcupados: number;
  /** Relative contribution to total occupied bed-days in the selected period (percentage) */
  contribucionRelativa: number;
  /** Mortality rate for this specialty over period discharges (percentage) */
  tasaMortalidad: number;
  /**
   * Average length of stay in days across exit events in the selected period.
   * Formula: Σ días de estada de egresos/traslados con ingreso resuelto ÷ número de esas estadías resueltas.
   * Uses the DEIS discharge rule: discharge date - admission date, with same-day admission/discharge = 1.
   * Invalid chronology (discharge before admission) is excluded instead of forcing a minimum.
   */
  promedioDiasEstada: number;
  /** Minimum observed stay among exit events in the selected period, resolved from the shared episode timeline */
  promedioDiasEstadaMinima?: number;
  /** Maximum observed stay among exit events in the selected period, resolved from the shared episode timeline */
  promedioDiasEstadaMaxima?: number;

  // ===== Traceability Lists =====
  /** List of patient-days that contributed to diasOcupados */
  diasOcupadosList?: PatientTraceability[];
  /** List of discharges that contributed to egresos */
  egresosList?: PatientTraceability[];
  /** List of transfers that contributed to traslados */
  trasladosList?: PatientTraceability[];
  /** List of Aerocardal transfers */
  aerocardalList?: PatientTraceability[];
  /** List of FACH transfers */
  fachList?: PatientTraceability[];
  /** List of deaths that contributed to fallecidos */
  fallecidosList?: PatientTraceability[];
}

export type MinsalMovementKind = 'discharge' | 'transfer' | 'cma';

export type SpecialtyGroupingMode = 'detailed' | 'group-other';

export interface SpecialtyReclassification {
  /** Date of the movement. Optional for legacy external callers, but preferred for audit-safe matching. */
  date?: string;
  movementKind: MinsalMovementKind;
  movementId: string;
  specialty: Specialty | string;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;
}

export interface AnalyticsSpecialtyReclassificationRecord {
  date: string;
  movementKind: MinsalMovementKind;
  movementId: string;
  originalSpecialty: Specialty | string;
  reportingSpecialty: Specialty | string | null;
  active: boolean;
  updatedAt: string;
  updatedByUid?: string | null;
  updatedByEmail?: string | null;
  updatedByName?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

export type AnalyticsDataQualityIssueSeverity = 'critico' | 'advertencia' | 'info';

export interface AnalyticsDataQualityIssue {
  id: string;
  severity: AnalyticsDataQualityIssueSeverity;
  title: string;
  description: string;
  date?: string;
  movementKind?: MinsalMovementKind | 'bed';
  movementId?: string;
  patientName?: string;
  rut?: string;
}

export interface MinsalComparisonMetric {
  current: number;
  previous: number | null;
  absoluteDelta: number | null;
  relativeDelta: number | null;
  direction: 'up' | 'down' | 'flat' | 'unavailable';
}

export interface MinsalComparisonSummary {
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  tasaOcupacion: MinsalComparisonMetric;
  egresosTotal: MinsalComparisonMetric;
  promedioDiasEstada: MinsalComparisonMetric;
  cmaTotal: MinsalComparisonMetric;
  mortalidadHospitalaria: MinsalComparisonMetric;
}

export interface MinsalCalculationOptions {
  specialtyGroupingMode?: SpecialtyGroupingMode;
  specialtyReclassifications?: SpecialtyReclassification[];
}

export interface CmaSpecialtyStats {
  /** Specialty used for statistical reporting */
  specialty: Specialty | string;
  /** Total CMA/PMA events in the period */
  total: number;
  /** Cirugía Mayor Ambulatoria events */
  cirugiaMayorAmbulatoria: number;
  /** Procedimiento Médico Ambulatorio events */
  procedimientoMedicoAmbulatorio: number;
  /** Traceability rows for this specialty */
  pacientesList?: PatientTraceability[];
}

export interface CmaStatistics {
  /** Total CMA/PMA events in the period */
  total: number;
  /** Cirugía Mayor Ambulatoria events */
  cirugiaMayorAmbulatoria: number;
  /** Procedimiento Médico Ambulatorio events */
  procedimientoMedicoAmbulatorio: number;
  /** Breakdown by statistical specialty */
  porEspecialidad: CmaSpecialtyStats[];
  /** Full traceability list */
  pacientesList?: PatientTraceability[];
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
   * Formula: Σ días de estada de egresos/traslados con ingreso resuelto ÷ número de esas estadías resueltas
   * Uses the DEIS discharge rule: discharge date - admission date, with same-day admission/discharge = 1.
   * Invalid chronology (discharge before admission) is excluded instead of forcing a minimum.
   */
  promedioDiasEstada: number;
  /** Minimum observed stay among exit events in the selected period, resolved from the shared episode timeline */
  promedioDiasEstadaMinima?: number;
  /** Maximum observed stay among exit events in the selected period, resolved from the shared episode timeline */
  promedioDiasEstadaMaxima?: number;

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
   * Formula: (Egresos Totales × 30) / Días Cama Disponibles
   */
  indiceRotacion: number;

  // ===== Current Snapshot =====
  /** Hospitalized patients in the latest available snapshot of the selected range */
  pacientesActuales: number;
  /** Occupied beds in the latest available snapshot of the selected range */
  camasOcupadas: number;
  /** Blocked beds in the latest available snapshot of the selected range */
  camasBloqueadas: number;
  /** Available beds (unblocked) in the latest available snapshot of the selected range */
  camasDisponibles: number;
  /** Free beds in the latest available snapshot of the selected range */
  camasLibres: number;
  /** Occupancy rate from the latest available snapshot inside the selected range */
  tasaOcupacionActual: number;

  // ===== Breakdown by Specialty =====
  /** Statistics per medical specialty */
  porEspecialidad: SpecialtyStats[];

  // ===== CMA / Hospitalización Diurna =====
  /** CMA/PMA events separated from hospital bed-day indicators */
  cma?: CmaStatistics;
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
 * Type of indicator for specialty traceability
 */
export type SpecialtyTraceabilityType =
  | 'dias-cama'
  | 'egresos'
  | 'fallecidos'
  | 'traslados'
  | 'aerocardal'
  | 'fach'
  | 'cma'
  | 'estada';

/**
 * Configuration for date range selection
 */
export interface DateRangeConfig {
  preset: DateRangePreset;
  startDate?: string;
  endDate?: string;
  currentYearMonth?: number;
}

/**
 * Labels for date range presets (Spanish)
 */
export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: 'Hoy',
  last7days: 'Últimos 7 días',
  lastMonth: 'Últimos 30 días',
  currentMonth: 'Mes actual',
  yearToDate: 'Inicio de año',
  last3Months: 'Últimos 3 meses',
  last6Months: 'Últimos 6 meses',
  last12Months: 'Últimos 12 meses',
  custom: 'Personalizado',
};
