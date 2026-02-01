/**
 * Month Integrity Service
 * Ensures all days in a month have initialized records.
 * 
 * Clinical Justification: Prevents data gaps that could affect 
 * statistical calculations and audit trails.
 */

import { getForDate, initializeDay } from './DailyRecordRepository';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of month integrity check
 */
export interface MonthIntegrityResult {
    success: boolean;
    initializedDays: string[];
    errors: string[];
    totalDays: number;
}

// ============================================================================
// Functions
// ============================================================================

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
): Promise<MonthIntegrityResult> => {
    const initializedDays: string[] = [];
    const errors: string[] = [];

    for (let day = 1; day <= upToDay; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const existing = await getForDate(dateStr);

        if (!existing) {
            try {
                const prevDateStr = day > 1
                    ? `${year}-${String(month).padStart(2, '0')}-${String(day - 1).padStart(2, '0')}`
                    : undefined;

                await initializeDay(dateStr, prevDateStr);
                initializedDays.push(dateStr);
            } catch (_error) {
                errors.push(dateStr);
            }
        }
    }

    return {
        success: errors.length === 0,
        initializedDays,
        errors,
        totalDays: upToDay
    };
};
