import type { Workbook } from 'exceljs';

import {
  buildLogicalSnapshotSheets,
  buildSummaryRows,
  buildUpcPatients,
  getMonthContext,
} from './censusHiddenSheetsAggregation';
import {
  getSummarySheetName,
  getUpcPatientsSheetName,
  UPC_DAILY_DETAIL_SHEET_NAME,
} from './censusHiddenSheetsConfig';
import type { CensusWorkbookSnapshotSheet } from './censusHiddenSheetsContracts';
import { applyHiddenSheetProtection } from './censusHiddenSheetsProtection';
import { renderSummarySheet } from './censusHiddenSummarySheet';
import { renderUpcDailyMatrixSheet, renderUpcPatientsSheet } from './censusHiddenUpcSheets';

export type { CensusWorkbookSnapshotSheet } from './censusHiddenSheetsContracts';

/**
 * Builds the census support sheets and inserts them at the beginning of the workbook.
 * The summary sheet stays structurally hidden; the UPC sheets remain visible and unlocked.
 * Visible day sheets are rendered afterwards by the shared census workbook builder.
 */
export const addCensusHiddenSheets = async (
  workbook: Workbook,
  snapshotSheets: CensusWorkbookSnapshotSheet[]
): Promise<void> => {
  if (snapshotSheets.length === 0) return;

  const logicalSheets = buildLogicalSnapshotSheets(snapshotSheets);
  const monthContext = getMonthContext(logicalSheets[logicalSheets.length - 1].record.date);
  const summaryRows = buildSummaryRows(logicalSheets);
  const upcPatients = buildUpcPatients(logicalSheets);

  const summarySheet = workbook.addWorksheet(
    getSummarySheetName(monthContext.monthName, monthContext.year)
  );
  renderSummarySheet({
    sheet: summarySheet,
    rows: summaryRows,
    firstDate: logicalSheets[0]?.record.date || '',
    lastDate: logicalSheets[logicalSheets.length - 1]?.record.date || '',
    monthName: monthContext.monthName,
    year: monthContext.year,
  });

  const upcSheet = workbook.addWorksheet(
    getUpcPatientsSheetName(monthContext.monthName, monthContext.year)
  );
  renderUpcPatientsSheet({
    sheet: upcSheet,
    patients: upcPatients,
    monthName: monthContext.monthName,
    year: monthContext.year,
  });

  const matrixSheet = workbook.addWorksheet(UPC_DAILY_DETAIL_SHEET_NAME);
  renderUpcDailyMatrixSheet({
    sheet: matrixSheet,
    patients: upcPatients,
    monthName: monthContext.monthName,
    year: monthContext.year,
    daysInMonth: monthContext.daysInMonth,
  });

  await applyHiddenSheetProtection(summarySheet);
};
