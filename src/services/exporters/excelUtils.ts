/**
 * Excel Utilities
 * Shared utilities for ExcelJS workbook creation and manipulation.
 *
 * This module centralizes ExcelJS handling to ensure consistent
 * ESM/CJS compatibility across the application.
 *
 * @module services/exporters/excelUtils
 */

import type { Workbook } from 'exceljs';
import {
  loadExcelJSModule,
  resolveExcelWorkbookConstructor,
} from '@/services/exporters/excelJsModuleLoader';

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
  const ExcelJS = await loadExcelJSModule();
  const WorkbookConstructor = resolveExcelWorkbookConstructor(ExcelJS);
  return new WorkbookConstructor();
};

/**
 * Standard border style for cells.
 */
export const BORDER_THIN = {
  top: { style: 'thin' as const },
  left: { style: 'thin' as const },
  bottom: { style: 'thin' as const },
  right: { style: 'thin' as const },
};

/**
 * Standard header fill style.
 */
export const HEADER_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFF5F5F5' },
};
