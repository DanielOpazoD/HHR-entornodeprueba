import type { Worksheet } from 'exceljs';

import { formatDateDDMMYYYY } from '@/services/exporters/excel/formatters';

import type { SummaryDayRow } from './censusHiddenSheetsContracts';
import {
  SPECIALTY_COLUMNS,
  SUMMARY_CONSOLIDATED_ROWS,
  SUMMARY_GROUP_HEADERS,
  SUMMARY_HEADERS,
  SUMMARY_OCCUPANCY_ALERT_THRESHOLD,
} from './censusHiddenSheetsConfig';
import {
  applyHeaderCell,
  getExcelColumnName,
  setMergedTitle,
  setRowFill,
} from './censusHiddenSheetsExcelHelpers';
import { solidFill, THIN_BORDER, toArgb } from './censusHiddenSheetsStyles';

export interface RenderSummarySheetInput {
  sheet: Worksheet;
  rows: SummaryDayRow[];
  firstDate: string;
  lastDate: string;
  monthName: string;
  year: string;
}

const SUMMARY_HEADER_COLORS = [
  '#2E75B6',
  '#2E75B6',
  '#2E75B6',
  '#2E75B6',
  '#2E75B6',
  '#2E75B6',
  '#70AD47',
  '#70AD47',
  '#70AD47',
  '#70AD47',
  '#D4A017',
  '#D4A017',
  '#D4A017',
  '#D4A017',
  '#D4A017',
  '#D4A017',
] as const;

const configureSummarySheetTitles = (
  sheet: Worksheet,
  monthName: string,
  year: string,
  firstDate: string,
  lastDate: string,
  totalRows: number
) => {
  setMergedTitle({
    sheet,
    range: 'A1:P1',
    value: `RESUMEN CENSO DIARIO — HOSPITAL HANGA ROA — ${monthName} ${year}`,
    font: { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    fill: solidFill('#1F4E79'),
    rowHeight: 30,
  });
  setMergedTitle({
    sheet,
    range: 'A2:P2',
    value: `Período: ${formatDateDDMMYYYY(firstDate)} al ${formatDateDDMMYYYY(lastDate)} (${totalRows} días registrados)`,
    font: { name: 'Arial', size: 10, italic: true, color: { argb: toArgb('#4472C4') } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  setMergedTitle({
    sheet,
    range: 'A4:P4',
    value: 'CENSO DIARIO DE CAMAS Y MOVIMIENTOS',
    font: { name: 'Arial', size: 11, bold: true, color: { argb: toArgb('#1F4E79') } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    fill: solidFill('#D6E4F0'),
    rowHeight: 22,
  });
};

const configureSummaryHeaders = (sheet: Worksheet) => {
  sheet.mergeCells('B5:F5');
  sheet.mergeCells('G5:J5');
  sheet.mergeCells('K5:P5');

  SUMMARY_GROUP_HEADERS.forEach(item => {
    applyHeaderCell({
      cell: sheet.getCell(item.cell),
      value: item.value,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      fill: solidFill(item.fill),
    });
  });

  const headerRow = sheet.getRow(6);
  SUMMARY_HEADERS.forEach((header, index) => {
    applyHeaderCell({
      cell: headerRow.getCell(index + 1),
      value: header,
      font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      fill: solidFill(SUMMARY_HEADER_COLORS[index] ?? '#2E75B6'),
    });
  });
};

const renderSummaryRows = (sheet: Worksheet, rows: SummaryDayRow[]) => {
  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(7 + index);
    excelRow.values = [
      row.displaySheetName,
      row.occupiedBeds,
      row.availableCapacity,
      row.blockedBeds,
      row.cribs,
      row.occupancyRate,
      row.discharges,
      row.transfers,
      row.cma,
      row.deceased,
      ...SPECIALTY_COLUMNS.map(item => row.specialtyCounts[item.key] || 0),
    ];
    setRowFill(excelRow, 1, 16, index % 2 === 0 ? '#FFFFFF' : '#F2F2F2');

    excelRow.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { horizontal: colNumber === 1 ? 'left' : 'center', vertical: 'middle' };

      if (colNumber === 6) {
        cell.numFmt = '0%';
        cell.font =
          typeof row.occupancyRate === 'number' &&
          row.occupancyRate > SUMMARY_OCCUPANCY_ALERT_THRESHOLD
            ? { name: 'Arial', size: 10, bold: true, color: { argb: toArgb('#C00000') } }
            : { name: 'Arial', size: 10, color: { argb: toArgb('#000000') } };
      }
    });
  });
};

const renderSummaryConsolidatedMetrics = (sheet: Worksheet, rows: SummaryDayRow[]) => {
  const dataStart = 7;
  const dataEnd = rows.length + 6;
  const titleRowNumber = dataEnd + 2;

  sheet.mergeCells(`A${titleRowNumber}:P${titleRowNumber}`);
  const titleCell = sheet.getCell(`A${titleRowNumber}`);
  titleCell.value = 'INDICADORES CONSOLIDADOS';
  titleCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: toArgb('#1F4E79') } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = solidFill('#D6E4F0');
  sheet.getRow(titleRowNumber).height = 22;

  SUMMARY_CONSOLIDATED_ROWS.forEach((item, index) => {
    const rowNumber = titleRowNumber + index + 1;
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = item.label;
    row.getCell(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    row.getCell(1).fill = solidFill(item.fill);
    row.getCell(1).border = THIN_BORDER;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    for (let col = 2; col <= 16; col += 1) {
      const columnLetter = getExcelColumnName(col);
      const cell = row.getCell(col);

      cell.value =
        col === 6 && item.label === 'Total'
          ? '—'
          : {
              formula: `${item.formula}(${columnLetter}${dataStart}:${columnLetter}${dataEnd})`,
            };
      cell.font = { name: 'Arial', size: 10, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = solidFill('#FFFFFF');
      cell.border = THIN_BORDER;
      cell.numFmt = col === 6 ? '0%' : item.label === 'Promedio' ? '0.0' : '0';
    }
  });
};

export const renderSummarySheet = ({
  sheet,
  rows,
  firstDate,
  lastDate,
  monthName,
  year,
}: RenderSummarySheetInput) => {
  sheet.columns = [{ width: 14 }, ...new Array(15).fill(null).map(() => ({ width: 11 }))];

  configureSummarySheetTitles(sheet, monthName, year, firstDate, lastDate, rows.length);
  configureSummaryHeaders(sheet);
  renderSummaryRows(sheet, rows);
  renderSummaryConsolidatedMetrics(sheet, rows);

  sheet.views = [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7' }];
};
