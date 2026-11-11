/**
 * MINSAL/DEIS statistics calculator - Facade
 */

import {
  DailyStatsSnapshot,
  SpecialtyTraceabilityType,
  PatientTraceability,
} from '@/types/minsalTypes';
import type { DailyRecordMovementState as MinsalDailyRecord } from '@/types/domain/dailyRecordSlices';

// Re-exports
export { getDateRangeFromPreset } from './minsal/dateUtils';
export { calculateMinsalStats, filterRecordsByDateRange } from './minsal/calculator';
export {
  normalizeSpecialty,
  normalizeEvacuationMethodLabel,
  isFachEvacuationMethod,
} from './minsal/normalization';
export { calculateDailySnapshot } from './minsal/snapshot';

// Import internal logic for facade functions
import { calculateDailySnapshot } from './minsal/snapshot';
import { buildSpecialtyTraceability as buildTraceability } from './minsal/traceability';

/**
 * Generate daily trend data for charts
 */
export function generateDailyTrend(records: MinsalDailyRecord[]): DailyStatsSnapshot[] {
  return records.map(calculateDailySnapshot).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Build traceability list lazily for a specialty + indicator type.
 * Re-exported for backward compatibility.
 */
export function buildSpecialtyTraceability(
  records: MinsalDailyRecord[],
  specialty: string,
  type: SpecialtyTraceabilityType
): PatientTraceability[] {
  return buildTraceability(records, specialty, type);
}

// Re-export type
export type { SpecialtyTraceabilityType };
