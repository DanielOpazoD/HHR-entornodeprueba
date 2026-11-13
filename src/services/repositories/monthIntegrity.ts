/**
 * Month Integrity Service
 * Ensures all days in a month have initialized records.
 *
 * Clinical Justification: Prevents data gaps that could affect
 * statistical calculations and audit trails.
 */

import { initializeDay } from './dailyRecordRepositoryInitializationService';
import { getRecordsForMonth } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  buildMonthIntegrityDateRange,
  createMonthIntegrityResult,
  getPreviousMonthIntegrityDate,
  type MonthIntegrityResult,
} from './monthIntegritySupport';
import { measureRepositoryOperation } from './repositoryPerformance';

/**
 * Ensures all days of a month up to a specified day are initialized.
 * Creates missing records by copying from the previous day.
 *
 * @param year - The year (e.g., 2025)
 * @param month - The month (1-12)
 * @param upToDay - Initialize up to this day of the month
 * @returns Result with list of initialized days and any errors
 */
export const ensureMonthIntegrity = async (
  year: number,
  month: number,
  upToDay: number
): Promise<MonthIntegrityResult> =>
  measureRepositoryOperation(
    'dailyRecord.ensureMonthIntegrity',
    async () => {
      const initializedDays: string[] = [];
      const errors: string[] = [];
      const dates = buildMonthIntegrityDateRange(year, month, upToDay);
      const localMonthRecords = await getRecordsForMonth(year, month);
      const localDateSet = new Set(localMonthRecords.map(record => record.date));

      for (const [index, date] of dates.entries()) {
        if (localDateSet.has(date)) {
          continue;
        }

        try {
          const initialized = await initializeDay(
            date,
            getPreviousMonthIntegrityDate(year, month, index + 1),
            { requireConfirmedAbsence: true }
          );
          if (initialized.date === date) {
            initializedDays.push(date);
            localDateSet.add(date);
          }
        } catch (_error) {
          errors.push(date);
        }
      }

      return createMonthIntegrityResult(initializedDays, errors, upToDay);
    },
    { thresholdMs: 250, context: `${year}-${String(month).padStart(2, '0')}` }
  );

export type { MonthIntegrityResult } from './monthIntegritySupport';
