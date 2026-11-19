/**
 * CSV Export Utilities
 * Pure functions for CSV file generation.
 */

/**
 * Escape a value for CSV format
 * Handles commas, quotes, and newlines
 */
export const escapeCsvValue = (val: string | number | boolean | null | undefined): string => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
};
