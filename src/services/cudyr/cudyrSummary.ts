/**
 * CUDYR Summary Calculation Service
 * Provides functions for aggregating CUDYR categorization statistics.
 *
 * @module services/calculations/cudyrSummary
 */

import { PatientData } from '@/services/contracts/patientServiceContracts';
import { BedType } from '@/types/domain/beds';
import type { DailyRecordCudyrState } from '@/services/contracts/dailyRecordServiceContracts';
import { BEDS } from '@/constants/beds';
import { getCategorization } from './CudyrScoreUtils';
import { isCudyrPatientEligible } from '@/domain/cudyr/cudyrEligibility';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';

// ============================================================================
// Type Definitions
// ============================================================================

/** All possible CUDYR categories (A1-D3) */
export type CudyrCategory =
  | 'A1'
  | 'A2'
  | 'A3'
  | 'B1'
  | 'B2'
  | 'B3'
  | 'C1'
  | 'C2'
  | 'C3'
  | 'D1'
  | 'D2'
  | 'D3';

/** Structure for categorized patient data */
export interface CategorizedPatient {
  bedId: string;
  bedName: string;
  bedType: BedType;
  patientName: string;
  rut: string;
  category: CudyrCategory;
  isCrib: boolean;
}

/** Category counts split by bed type */
export interface CategoryCounts {
  uti: Record<CudyrCategory, number>;
  media: Record<CudyrCategory, number>;
}

/** Summary result with counts and statistics */
export interface CudyrDailySummary {
  date: string;
  counts: CategoryCounts;
  utiTotal: number;
  mediaTotal: number;
  occupiedCount: number;
  categorizedCount: number;
}

/** Monthly aggregation result */
export interface CudyrMonthlySummary {
  year: number;
  month: number;
  endDate?: string;
  totals: CategoryCounts;
  utiTotal: number;
  mediaTotal: number;
  totalOccupied: number;
  totalCategorized: number;
  dailySummaries: CudyrDailySummary[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Create empty category counts */
const createEmptyCounts = (): Record<CudyrCategory, number> => ({
  A1: 0,
  A2: 0,
  A3: 0,
  B1: 0,
  B2: 0,
  B3: 0,
  C1: 0,
  C2: 0,
  C3: 0,
  D1: 0,
  D2: 0,
  D3: 0,
});

/** Get bed definition by ID */
export const resolveVisibleCudyrBeds = (record: Pick<DailyRecordCudyrState, 'activeExtraBeds'>) => {
  const activeExtras = record.activeExtraBeds || [];
  return BEDS.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));
};

const resolvePatientCudyrCategory = (
  patient: PatientData,
  censusDate: string
): { category: CudyrCategory; isCategorized: boolean } => {
  const importedCudyr = patient.evaluationScores?.cudyr;
  const imported = String(importedCudyr?.category || '')
    .trim()
    .toUpperCase();
  const validImportedCategory = /^[A-D][1-3]$/.test(imported);
  if (importedCudyrBelongsToCensus(importedCudyr, censusDate) && validImportedCategory) {
    return { category: imported as CudyrCategory, isCategorized: true };
  }
  const { finalCat, isCategorized } = getCategorization(patient.cudyr);
  return { category: finalCat as CudyrCategory, isCategorized };
};

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Collects all categorized patients from a daily record.
 * Includes clinical cribs.
 *
 * @param record - The daily record to process
 * @returns Array of categorized patients
 */
export const collectDailyCudyrPatients = (record: DailyRecordCudyrState): CategorizedPatient[] => {
  const patients: CategorizedPatient[] = [];
  const visibleBeds = resolveVisibleCudyrBeds(record);

  visibleBeds.forEach(bed => {
    const patient = record.beds[bed.id];
    if (!patient) return;

    // Process main patient
    if (isCudyrPatientEligible(record.date, patient)) {
      const { category, isCategorized } = resolvePatientCudyrCategory(patient, record.date);
      if (isCategorized) {
        patients.push({
          bedId: bed.id,
          bedName: bed.name,
          bedType: bed.type,
          patientName: patient.patientName,
          rut: patient.rut || '',
          category,
          isCrib: false,
        });
      }
    }

    // Process clinical crib
    const clinicalCrib = patient.clinicalCrib;
    if (clinicalCrib && isCudyrPatientEligible(record.date, clinicalCrib)) {
      const { category, isCategorized } = resolvePatientCudyrCategory(clinicalCrib, record.date);
      if (isCategorized) {
        patients.push({
          bedId: `${bed.id}-crib`,
          bedName: `${bed.name} (CC)`,
          bedType: bed.type,
          patientName: clinicalCrib.patientName,
          rut: clinicalCrib.rut || '',
          category,
          isCrib: true,
        });
      }
    }
  });

  return patients;
};

/**
 * Builds the daily CUDYR summary with category counts split by UTI/Media.
 *
 * @param record - The daily record to process
 * @returns Daily summary object with counts and statistics
 */
export const buildDailyCudyrSummary = (record: DailyRecordCudyrState): CudyrDailySummary => {
  const counts: CategoryCounts = {
    uti: createEmptyCounts(),
    media: createEmptyCounts(),
  };

  let utiTotal = 0;
  let mediaTotal = 0;
  let occupiedCount = 0;
  let categorizedCount = 0;

  const visibleBeds = resolveVisibleCudyrBeds(record);

  visibleBeds.forEach(bed => {
    const patient = record.beds[bed.id];
    if (!patient) return;

    const processPatient = (p: PatientData, bedType: BedType) => {
      if (!isCudyrPatientEligible(record.date, p)) return;
      occupiedCount++;

      const { category, isCategorized } = resolvePatientCudyrCategory(p, record.date);
      if (isCategorized) {
        categorizedCount++;
        const cat = category;
        if (bedType === BedType.UTI) {
          counts.uti[cat]++;
          utiTotal++;
        } else {
          counts.media[cat]++;
          mediaTotal++;
        }
      }
    };

    // Main patient
    processPatient(patient, bed.type);

    // Clinical crib (inherits parent bed type)
    if (patient.clinicalCrib) {
      processPatient(patient.clinicalCrib, bed.type);
    }
  });

  return {
    date: record.date,
    counts,
    utiTotal,
    mediaTotal,
    occupiedCount,
    categorizedCount,
  };
};

/**
 * Gets aggregated monthly totals from Firestore.
 * Fetches each day's record and aggregates the summaries.
 *
 * @param year - Year to aggregate
 * @param month - Month (1-12) to aggregate
 * @param endDate - Optional end date (YYYY-MM-DD) to limit aggregation
 * @param fetchRecordFn - Function to fetch a DailyRecord by date string
 * @returns Monthly summary with aggregated counts
 */
export const getCudyrMonthlyTotals = async (
  year: number,
  month: number,
  endDate: string | undefined,
  fetchRecordFn: (dateStr: string) => Promise<DailyRecordCudyrState | null>,
  overrideRecord?: DailyRecordCudyrState | null // Optional override for current day
): Promise<CudyrMonthlySummary> => {
  const totals: CategoryCounts = {
    uti: createEmptyCounts(),
    media: createEmptyCounts(),
  };

  let utiTotal = 0;
  let mediaTotal = 0;
  let totalOccupied = 0;
  let totalCategorized = 0;
  const dailySummaries: CudyrDailySummary[] = [];

  // Determine date range
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const endDay = endDate
    ? Math.min(parseInt(endDate.split('-')[2], 10), lastDayOfMonth)
    : lastDayOfMonth;

  for (let day = 1; day <= endDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    let record: DailyRecordCudyrState | null = null;

    // Use override if available and matches date
    if (overrideRecord && overrideRecord.date === dateStr) {
      record = overrideRecord;
    } else {
      record = await fetchRecordFn(dateStr);
    }

    if (record) {
      const summary = buildDailyCudyrSummary(record);
      dailySummaries.push(summary);

      // Aggregate counts
      (Object.keys(summary.counts.uti) as CudyrCategory[]).forEach(cat => {
        totals.uti[cat] += summary.counts.uti[cat];
        totals.media[cat] += summary.counts.media[cat];
      });

      utiTotal += summary.utiTotal;
      mediaTotal += summary.mediaTotal;
      totalOccupied += summary.occupiedCount;
      totalCategorized += summary.categorizedCount;
    }
  }

  return {
    year,
    month,
    endDate,
    totals,
    utiTotal,
    mediaTotal,
    totalOccupied,
    totalCategorized,
    dailySummaries,
  };
};
