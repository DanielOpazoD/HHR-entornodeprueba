/**
 * Excel Utilities
 * Shared utilities for ExcelJS workbook creation and manipulation.
 * 
 * This module centralizes ExcelJS handling to ensure consistent
 * ESM/CJS compatibility across the application.
 * 
 * @module services/exporters/excelUtils
 */

import type { Workbook, Worksheet } from 'exceljs';

// ExcelJS import - Vite pre-bundles this from CommonJS to ESM
// import * as ExcelJSModule from 'exceljs';

interface ExcelJSModuleType {
    Workbook: typeof import('exceljs').Workbook;
    default?: {
        Workbook: typeof import('exceljs').Workbook;
    } | typeof import('exceljs').Workbook; // Handle case where default IS the module
}

/**
 * Creates a new ExcelJS Workbook instance.
 * Handles ESM/CJS compatibility automatically.
 * 
 * @returns {Workbook} A new ExcelJS Workbook instance
 * @throws {Error} If ExcelJS module cannot be loaded
 * 
 * @example
 * const workbook = await createWorkbook();
 * workbook.creator = 'Hospital Hanga Roa';
 * const sheet = workbook.addWorksheet('Data');
 */
export const createWorkbook = async (): Promise<Workbook> => {
    // Dynamic import
    const ExcelJSModule = await import('exceljs');

    // After Vite pre-bundles, ExcelJS.Workbook should be available
    const ExcelJS = ExcelJSModule as unknown as ExcelJSModuleType;

    if (ExcelJS.Workbook) {
        return new ExcelJS.Workbook();
    }

    // Check if default has Workbook property
    if (ExcelJS.default && 'Workbook' in ExcelJS.default) {
        return new ExcelJS.default.Workbook();
    }

    // Check if default export IS the module (common in some CJS -> ESM interops)
    /* if (typeof ExcelJS.default === 'function' && 'Workbook' in ExcelJS.default) {
       // This branch is harder to type safely without more complex conditional types, 
       // but the 'Workbook' check above usually covers it if default is an object
    } */

    // For CommonJS interop where default is an object containing Workbook
    if (typeof ExcelJS.default === 'object' && ExcelJS.default !== null) {
        // unsafe cast but bounded scope - last resort
        const defaultObj = ExcelJS.default as { Workbook?: typeof ExcelJSModule.Workbook };
        if (defaultObj.Workbook) {
            return new defaultObj.Workbook();
        }
    }

    throw new Error('ExcelJS module could not be loaded correctly. Check vite.config.ts optimizeDeps.include.');
};

/**
 * Saves a workbook to a buffer for download or attachment.
 * 
 * @param workbook - The ExcelJS Workbook to convert
 * @returns {Promise<Buffer>} Buffer containing the xlsx file data
 */
export const workbookToBuffer = async (workbook: Workbook): Promise<Buffer> => {
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
};

/**
 * Standard border style for cells.
 */
export const BORDER_THIN = {
    top: { style: 'thin' as const },
    left: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    right: { style: 'thin' as const }
};

/**
 * Standard header fill style.
 */
export const HEADER_FILL = {
    type: 'pattern' as const,
    pattern: 'solid' as const,
    fgColor: { argb: 'FFF5F5F5' }
};

/**
 * Auto-fits column widths based on content (simplified approach).
 * 
 * @param worksheet - The worksheet to auto-fit
 * @param minWidth - Minimum column width (default: 10)
 * @param maxWidth - Maximum column width (default: 50)
 */
export const autoFitColumns = (
    worksheet: Worksheet,
    minWidth: number = 10,
    maxWidth: number = 50
): void => {
    worksheet.columns.forEach(column => {
        if (column.values) {
            const lengths = column.values
                .filter(v => v != null)
                .map(v => String(v).length);
            const maxLength = Math.max(...lengths, minWidth);
            column.width = Math.min(maxLength + 2, maxWidth);
        } else {
            column.width = minWidth;
        }
    });
};
