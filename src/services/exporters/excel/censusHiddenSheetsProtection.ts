import type { Worksheet } from 'exceljs';

export const CENSUS_HIDDEN_SHEETS_PASSWORD = 'HHR';
export const CENSUS_WORKBOOK_STRUCTURE_PASSWORD = 'HHR';

export const CENSUS_HIDDEN_SHEET_PROTECTION_OPTIONS = {
  selectLockedCells: false,
  selectUnlockedCells: false,
  formatCells: false,
  formatColumns: false,
  formatRows: false,
  insertColumns: false,
  insertRows: false,
  insertHyperlinks: false,
  deleteColumns: false,
  deleteRows: false,
  sort: false,
  autoFilter: false,
  pivotTables: false,
  spinCount: 1000,
} as const;

/**
 * Hidden census sheets are protected individually and kept hidden in the workbook.
 * Structure protection is applied later by the OOXML serializer.
 */
export const applyHiddenSheetProtection = async (sheet: Worksheet): Promise<void> => {
  await sheet.protect(CENSUS_HIDDEN_SHEETS_PASSWORD, CENSUS_HIDDEN_SHEET_PROTECTION_OPTIONS);
  sheet.state = 'hidden';
};
