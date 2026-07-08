import type { Worksheet } from 'exceljs';

const CENSUS_DAY_SHEET_WIDTHS = [4, 10, 9, 24, 16, 8, 28, 16, 12, 12, 7, 7, 7, 7, 18];

export const applyCensusDaySheetColumnLayout = (worksheet: Worksheet): void => {
  CENSUS_DAY_SHEET_WIDTHS.forEach((width, idx) => {
    worksheet.getColumn(idx + 1).width = width;
  });
};
