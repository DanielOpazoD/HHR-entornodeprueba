import type { Workbook, Worksheet } from 'exceljs';
import { createWorkbook, BORDER_THIN } from '@/services/exporters/excelUtils';
import type { CategoryCounts, CudyrDailySummary, CudyrMonthlySummary } from './cudyrSummary';
import {
  addMonthlySummarySheet,
  buildMonthlyCutoffLabel,
  CATEGORIES,
  formatDateDMY,
  MONTHS_ES,
  safeResult,
} from './cudyrWorkbookSections';

const addDailySummaryTable = (
  sheet: Worksheet,
  counts: CategoryCounts,
  utiTotal: number,
  mediaTotal: number,
  startRow: number
): number => {
  const headerRow = sheet.getRow(startRow);
  headerRow.values = ['CAT', 'UTI', 'MEDIA', 'TOTAL'];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };
  ['A', 'B', 'C', 'D'].forEach(col => {
    const cell = sheet.getCell(`${col}${startRow}`);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = BORDER_THIN;
  });

  let currentRow = startRow + 1;
  CATEGORIES.forEach(cat => {
    const row = sheet.getRow(currentRow);
    const utiCount = counts.uti[cat];
    const mediaCount = counts.media[cat];
    row.values = [cat, utiCount, mediaCount, utiCount + mediaCount];
    row.alignment = { horizontal: 'center' };
    ['A', 'B', 'C', 'D'].forEach(col => {
      sheet.getCell(`${col}${currentRow}`).border = BORDER_THIN;
    });
    currentRow++;
  });

  const totalRow = sheet.getRow(currentRow);
  totalRow.values = ['TOTAL', utiTotal, mediaTotal, utiTotal + mediaTotal];
  totalRow.font = { bold: true };
  totalRow.alignment = { horizontal: 'center' };
  ['A', 'B', 'C', 'D'].forEach(col => {
    const cell = sheet.getCell(`${col}${currentRow}`);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = BORDER_THIN;
  });

  return currentRow + 1;
};

const addDailyOccupationStats = (
  sheet: Worksheet,
  occupiedCount: number,
  categorizedCount: number,
  startRow: number
): number => {
  const sectionRow = sheet.getRow(startRow);
  sectionRow.values = ['Estadisticas de Ocupacion'];
  sectionRow.font = { bold: true, size: 11 };
  sheet.mergeCells(`A${startRow}:D${startRow}`);

  const occupiedRow = sheet.getRow(startRow + 1);
  occupiedRow.values = ['Camas Ocupadas', occupiedCount];
  occupiedRow.getCell(1).font = { bold: true };
  occupiedRow.getCell(2).alignment = { horizontal: 'center' };

  const categorizedRow = sheet.getRow(startRow + 2);
  categorizedRow.values = ['Pacientes Categorizados', categorizedCount];
  categorizedRow.getCell(1).font = { bold: true };
  categorizedRow.getCell(2).alignment = { horizontal: 'center' };

  const indexVal = occupiedCount > 0 ? Math.round((categorizedCount / occupiedCount) * 100) : 0;
  const indexRow = sheet.getRow(startRow + 3);
  indexRow.values = ['Indice de Categorizacion'];
  indexRow.getCell(1).font = { bold: true };

  const indexCell = sheet.getCell(`B${startRow + 3}`);
  indexCell.value = {
    formula: `IF(B${startRow + 1}=0,0,ROUND(B${startRow + 2}/B${startRow + 1}*100,0))`,
    result: safeResult(indexVal),
  };
  indexCell.numFmt = '0"%"';
  indexCell.alignment = { horizontal: 'center' };

  return startRow + 4;
};

const addDailySheets = (workbook: Workbook, dailySummaries: CudyrDailySummary[]): string[] => {
  const dailySheetNames: string[] = [];

  dailySummaries.forEach(daySummary => {
    const sheetName = formatDateDMY(daySummary.date);
    dailySheetNames.push(sheetName);

    const daySheet = workbook.addWorksheet(sheetName);
    daySheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
    daySheet.columns = [{ width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }];
    daySheet.getCell('A1').value = `CUDYR Diario del Registro - ${sheetName}`;
    daySheet.getCell('A1').font = { bold: true, size: 12 };
    daySheet.mergeCells('A1:D1');

    addDailySummaryTable(
      daySheet,
      daySummary.counts,
      daySummary.utiTotal,
      daySummary.mediaTotal,
      3
    );
    addDailyOccupationStats(daySheet, daySummary.occupiedCount, daySummary.categorizedCount, 18);
  });

  return dailySheetNames;
};

interface BuildCudyrWorkbookParams {
  year: number;
  month: number;
  endDate?: string;
  monthlySummary: CudyrMonthlySummary;
}

export const buildCudyrWorkbook = async ({
  year,
  month,
  endDate,
  monthlySummary,
}: BuildCudyrWorkbookParams): Promise<{ workbook: Workbook; fileName: string }> => {
  const workbook = await createWorkbook();
  workbook.creator = 'Hospital Hanga Roa';
  workbook.created = new Date();
  workbook.views = [
    {
      x: 0,
      y: 0,
      width: 24_000,
      height: 16_000,
      activeTab: 0,
      firstSheet: 0,
      visibility: 'visible',
    },
  ];

  const dailySheetNames = monthlySummary.dailySummaries.map(daySummary =>
    formatDateDMY(daySummary.date)
  );
  addMonthlySummarySheet(
    workbook,
    year,
    month,
    endDate,
    monthlySummary,
    dailySheetNames,
    BORDER_THIN
  );
  addDailySheets(workbook, monthlySummary.dailySummaries);

  return {
    workbook,
    fileName: `CUDYR_Mensual_${MONTHS_ES[month - 1]}_${year}_${buildMonthlyCutoffLabel(year, month, endDate).replaceAll(' ', '_')}.xlsx`,
  };
};
