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

/**
 * Convert array of objects to CSV string
 */
export const arrayToCsv = <T extends Record<string, unknown>>(
    data: T[],
    headers: { key: keyof T; label: string }[]
): string => {
    const headerRow = headers.map(h => escapeCsvValue(h.label)).join(',');
    const dataRows = data.map(row =>
        headers.map(h => escapeCsvValue(row[h.key] as string | number | boolean | null | undefined)).join(',')
    );
    return [headerRow, ...dataRows].join('\n');
};

/**
 * Trigger CSV download in browser
 */
export const downloadCsv = (content: string, filename: string): void => {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
};
