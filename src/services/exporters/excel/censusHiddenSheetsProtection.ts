import type { Worksheet } from 'exceljs';

const CENSUS_HIDDEN_SHEETS_PASSWORD = 'HHR';
export const CENSUS_WORKBOOK_STRUCTURE_PASSWORD = 'HHR';

const CENSUS_HIDDEN_SHEET_PROTECTION_OPTIONS = {
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

export const CENSUS_COSMETIC_SHEET_PROTECTION_OPTIONS = {
  ...CENSUS_HIDDEN_SHEET_PROTECTION_OPTIONS,
} as const;

const hideSheetRowsAndColumns = (sheet: Worksheet): void => {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    sheet.getRow(rowNumber).hidden = true;
  }
};

/**
 * Hidden census sheets are protected individually and kept hidden in the workbook.
 * Structure protection is applied later by the OOXML serializer.
 */
export const applyHiddenSheetProtection = async (sheet: Worksheet): Promise<void> => {
  await sheet.protect(CENSUS_HIDDEN_SHEETS_PASSWORD, CENSUS_HIDDEN_SHEET_PROTECTION_OPTIONS);
  sheet.state = 'hidden';
};

/**
 * Cosmetic locking keeps the tab visible but hides all rendered content.
 * The sheet remains protected until the user explicitly unprotects it.
 */
export const applyCosmeticSheetProtection = async (sheet: Worksheet): Promise<void> => {
  hideSheetRowsAndColumns(sheet);
  await sheet.protect(CENSUS_HIDDEN_SHEETS_PASSWORD, CENSUS_COSMETIC_SHEET_PROTECTION_OPTIONS);
  sheet.state = 'visible';
};
