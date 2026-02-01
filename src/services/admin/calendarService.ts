/**
 * Chilean Calendar Service
 * 
 * Manages public holidays and business days for Chile (2025-2028).
 * Used for clinical shift determination and payroll/audit logic.
 */

/**
 * List of Chilean public holidays (Fixed and Variable)
 * Format: YYYY-MM-DD
 */
const CHILEAN_HOLIDAYS: Set<string> = new Set([
    // 2025 (Partial/Remaining)
    '2025-01-01', '2025-04-18', '2025-04-19', '2025-05-01', '2025-05-21',
    '2025-06-20', '2025-06-29', '2025-07-16', '2025-08-15', '2025-09-18',
    '2025-09-19', '2025-10-12', '2025-10-31', '2025-11-01', '2025-12-08', '2025-12-25',

    // 2026
    '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21',
    '2026-06-21', '2026-06-29', '2026-07-16', '2026-08-15', '2026-09-18',
    '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25',

    // 2027
    '2027-01-01', '2027-03-26', '2027-03-27', '2027-05-01', '2027-05-21',
    '2027-06-21', '2027-06-29', '2027-07-16', '2027-08-15', '2027-09-17',
    '2027-09-18', '2027-09-19', '2027-10-11', '2027-10-31', '2027-11-01', '2027-12-08', '2027-12-25',

    // 2028
    '2028-01-01', '2028-04-14', '2028-04-15', '2028-05-01', '2028-05-21',
    '2028-06-20', '2028-06-29', '2028-07-16', '2028-08-15', '2028-09-18',
    '2028-09-19', '2028-10-09', '2028-10-27', '2028-11-01', '2028-12-08', '2028-12-25',
]);

/**
 * Checks if a date is a public holiday in Chile.
 */
export const isHoliday = (date: Date): boolean => {
    const isoDate = date.toISOString().split('T')[0];
    return CHILEAN_HOLIDAYS.has(isoDate);
};

/**
 * Checks if a date is a weekend (Saturday or Sunday).
 */
export const isWeekend = (date: Date): boolean => {
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

/**
 * Checks if a date is a non-working day (Holiday or Weekend).
 * Clinically known as "Día Inhábil".
 */
export const isNonWorkingDay = (date: Date): boolean => {
    return isWeekend(date) || isHoliday(date);
};

/**
 * Checks if a date is a regular working day (Monday-Friday and not a holiday).
 * Clinically known as "Día Hábil".
 */
export const isWorkingDay = (date: Date): boolean => {
    return !isNonWorkingDay(date);
};
