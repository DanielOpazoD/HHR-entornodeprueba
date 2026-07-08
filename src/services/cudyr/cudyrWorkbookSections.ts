import type { Workbook, Worksheet } from 'exceljs';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

import type { CategoryCounts, CudyrCategory, CudyrMonthlySummary } from './cudyrSummary';

export const CATEGORIES: CudyrCategory[] = [
  'A1',
  'A2',
  'A3',
  'B1',
  'B2',
  'B3',
  'C1',
  'C2',
  'C3',
  'D1',
  'D2',
  'D3',
];

export const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const DAILY_SHEET_CATEGORY_START_ROW = 4;
const DAILY_SHEET_OCCUPIED_ROW = 19;
const DAILY_SHEET_CATEGORIZED_ROW = 20;

/** @deprecated Use formatDateDDMMYYYY from dateFormattingUtils — identical logic */
export const formatDateDMY = (dateStr: string): string => formatDateDDMMYYYY(dateStr);

export const buildMonthlyCutoffLabel = (year: number, month: number, endDate?: string): string => {
  const endDateFormatted = endDate
    ? formatDateDMY(endDate)
    : `${new Date(year, month, 0).getDate()}-${String(month).padStart(2, '0')}-${year}`;
  return `hasta el último registro disponible del ${endDateFormatted}`;
};

const escapeSheetName = (name: string): string => {
  if (/[^\w]/.test(name)) {
    return `'${name}'`;
  }
  return name;
};

export const safeResult = (value: number | string): number | string => (value === 0 ? '0' : value);

const addMonthlySummaryTableWithFormulas = (
  sheet: Worksheet,
  sheetNames: string[],
  startRow: number,
  totals: CategoryCounts,
  utiTotal: number,
  mediaTotal: number,
  borderThin: Partial<import('exceljs').Borders>
): number => {
  const headerRow = sheet.getRow(startRow);
  headerRow.values = ['CAT', 'UTI', 'MEDIA', 'TOTAL'];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center' };
  ['A', 'B', 'C', 'D'].forEach(col => {
    const cell = sheet.getCell(`${col}${startRow}`);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = borderThin;
  });

  let currentRow = startRow + 1;
  CATEGORIES.forEach((category, index) => {
    const dailyDataRow = DAILY_SHEET_CATEGORY_START_ROW + index;
    const row = sheet.getRow(currentRow);
    const utiValue = totals.uti[category];
    const mediaValue = totals.media[category];
    const totalValue = utiValue + mediaValue;

    row.getCell(1).value = category;
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(1).border = borderThin;

    row.getCell(2).value = {
      formula: sheetNames.map(name => `${escapeSheetName(name)}!B${dailyDataRow}`).join('+'),
      result: safeResult(utiValue),
    };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(2).border = borderThin;

    row.getCell(3).value = {
      formula: sheetNames.map(name => `${escapeSheetName(name)}!C${dailyDataRow}`).join('+'),
      result: safeResult(mediaValue),
    };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(3).border = borderThin;

    row.getCell(4).value = {
      formula: `B${currentRow}+C${currentRow}`,
      result: safeResult(totalValue),
    };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(4).border = borderThin;

    currentRow++;
  });

  const totalRow = sheet.getRow(currentRow);
  totalRow.getCell(1).value = 'TOTAL';
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(1).alignment = { horizontal: 'center' };
  totalRow.getCell(1).border = borderThin;

  for (const [column, value] of [
    ['B', utiTotal],
    ['C', mediaTotal],
    ['D', utiTotal + mediaTotal],
  ] as const) {
    const cell = totalRow.getCell(column);
    cell.value = {
      formula: `SUM(${column}${startRow + 1}:${column}${currentRow - 1})`,
      result: safeResult(value),
    };
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = borderThin;
  }

  return currentRow + 1;
};

const addMonthlyOccupationStatsWithFormulas = (
  sheet: Worksheet,
  sheetNames: string[],
  startRow: number,
  totalOccupied: number,
  totalCategorized: number
) => {
  const sectionRow = sheet.getRow(startRow);
  sectionRow.values = ['Estadisticas de Ocupacion (Acumulado)'];
  sectionRow.font = { bold: true, size: 11 };
  sheet.mergeCells(`A${startRow}:D${startRow}`);

  const occupiedRow = sheet.getRow(startRow + 1);
  occupiedRow.getCell(1).value = 'Camas Ocupadas';
  occupiedRow.getCell(1).font = { bold: true };
  occupiedRow.getCell(2).value = {
    formula: sheetNames
      .map(name => `${escapeSheetName(name)}!B${DAILY_SHEET_OCCUPIED_ROW}`)
      .join('+'),
    result: safeResult(totalOccupied),
  };
  occupiedRow.getCell(2).alignment = { horizontal: 'center' };

  const categorizedRow = sheet.getRow(startRow + 2);
  categorizedRow.getCell(1).value = 'Pacientes Categorizados';
  categorizedRow.getCell(1).font = { bold: true };
  categorizedRow.getCell(2).value = {
    formula: sheetNames
      .map(name => `${escapeSheetName(name)}!B${DAILY_SHEET_CATEGORIZED_ROW}`)
      .join('+'),
    result: safeResult(totalCategorized),
  };
  categorizedRow.getCell(2).alignment = { horizontal: 'center' };

  const indexValue = totalOccupied > 0 ? Math.round((totalCategorized / totalOccupied) * 100) : 0;
  const indexRow = sheet.getRow(startRow + 3);
  indexRow.getCell(1).value = 'Indice de Categorizacion';
  indexRow.getCell(1).font = { bold: true };
  indexRow.getCell(2).value = {
    formula: `IF(B${startRow + 1}=0,0,ROUND(B${startRow + 2}/B${startRow + 1}*100,0))`,
    result: safeResult(indexValue),
  };
  indexRow.getCell(2).numFmt = '0"%"';
  indexRow.getCell(2).alignment = { horizontal: 'center' };
};

export const addMonthlySummarySheet = (
  workbook: Workbook,
  year: number,
  month: number,
  endDate: string | undefined,
  monthlySummary: CudyrMonthlySummary,
  dailySheetNames: string[],
  borderThin: Partial<import('exceljs').Borders>
): void => {
  const summarySheet = workbook.addWorksheet('Resumen CUDYR Mensual', {
    properties: { tabColor: { argb: 'FF4CAF50' } },
  });
  summarySheet.views = [{ state: 'frozen', ySplit: 2 }];
  summarySheet.columns = [{ width: 22 }, { width: 10 }, { width: 10 }, { width: 10 }];

  summarySheet.getCell('A1').value =
    `Resumen CUDYR mensual - ${MONTHS_ES[month - 1]} ${year} (${buildMonthlyCutoffLabel(year, month, endDate)})`;
  summarySheet.getCell('A1').font = { bold: true, size: 14 };
  summarySheet.mergeCells('A1:D1');

  if (dailySheetNames.length === 0) {
    summarySheet.getCell('A3').value = 'No hay datos para el periodo seleccionado.';
    summarySheet.getCell('A3').font = { italic: true, color: { argb: 'FF888888' } };
    return;
  }

  const summaryTableEndRow =
    addMonthlySummaryTableWithFormulas(
      summarySheet,
      dailySheetNames,
      3,
      monthlySummary.totals,
      monthlySummary.utiTotal,
      monthlySummary.mediaTotal,
      borderThin
    ) + 2;

  addMonthlyOccupationStatsWithFormulas(
    summarySheet,
    dailySheetNames,
    summaryTableEndRow,
    monthlySummary.totalOccupied,
    monthlySummary.totalCategorized
  );
};
