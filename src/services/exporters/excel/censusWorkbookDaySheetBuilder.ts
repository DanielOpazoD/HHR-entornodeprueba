import type { Workbook } from 'exceljs';

import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import { calculateStats } from '@/services/calculations/statsCalculator';
import { addHeaderSection } from '@/services/exporters/excel/sections/headerSection';
import { addSummarySection } from '@/services/exporters/excel/sections/summarySection';
import { addCensusTable } from '@/services/exporters/excel/sections/censusTable';
import {
  addMovementTable,
  CMA_TABLE,
  DISCHARGES_TABLE,
  TRANSFERS_TABLE,
} from '@/services/exporters/excel/sections/movementTables';
import { applyCensusDaySheetColumnLayout } from '@/services/exporters/excel/censusWorkbookColumnLayout';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/domain/movements/movementTombstonePolicy';

export const createCensusWorkbookDaySheet = (
  workbook: Workbook,
  record: CensusExportRecord,
  sheetName: string,
  snapshotLabel?: string
): void => {
  const sheet = workbook.addWorksheet(sheetName, {
    pageSetup: { paperSize: 9, orientation: 'landscape' },
  });

  let currentRow = 1;
  currentRow = addHeaderSection(sheet, record, currentRow, snapshotLabel);
  currentRow++;

  const stats = calculateStats(record.beds);
  currentRow = addSummarySection(sheet, record, stats, currentRow);
  currentRow++;

  currentRow = addCensusTable(sheet, record, currentRow);
  currentRow++;

  currentRow = addMovementTable(
    sheet,
    DISCHARGES_TABLE,
    getActiveDischarges(record.discharges),
    currentRow
  );
  currentRow++;

  currentRow = addMovementTable(
    sheet,
    TRANSFERS_TABLE,
    getActiveTransfers(record.transfers),
    currentRow
  );
  currentRow++;

  addMovementTable(sheet, CMA_TABLE, getActiveCma(record.cma), currentRow);
  applyCensusDaySheetColumnLayout(sheet);
};
