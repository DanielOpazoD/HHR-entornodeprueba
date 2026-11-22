import type { Alignment, Cell, Fill, Font, Worksheet } from 'exceljs';

import { solidFill, THIN_BORDER } from './censusHiddenSheetsStyles';

export const getExcelColumnName = (columnIndex: number): string => {
  let dividend = columnIndex;
  let columnName = '';

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
};

export const setRowFill = (
  row: Worksheet['lastRow'],
  from: number,
  to: number,
  fill: Fill | string
) => {
  if (!row) return;
  const resolvedFill = typeof fill === 'string' ? solidFill(fill) : fill;
  for (let col = from; col <= to; col += 1) {
    row.getCell(col).fill = resolvedFill;
  }
};

export const setMergedTitle = ({
  sheet,
  range,
  value,
  font,
  alignment,
  fill,
  rowHeight,
}: {
  sheet: Worksheet;
  range: string;
  value: string;
  font: Partial<Font>;
  alignment: Partial<Alignment>;
  fill?: Fill;
  rowHeight?: number;
}) => {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(':')[0] ?? range);
  cell.value = value;
  cell.font = font;
  cell.alignment = alignment;
  if (fill) {
    cell.fill = fill;
  }
  if (rowHeight) {
    const rowNumber = Number(range.match(/\d+/)?.[0] || 0);
    if (rowNumber > 0) {
      sheet.getRow(rowNumber).height = rowHeight;
    }
  }
};

export const applyHeaderCell = ({
  cell,
  value,
  font,
  fill,
  alignment,
}: {
  cell: Cell;
  value: string | number;
  font: Partial<Font>;
  fill: Fill;
  alignment: Partial<Alignment>;
}) => {
  cell.value = value;
  cell.font = font;
  cell.fill = fill;
  cell.alignment = alignment;
  cell.border = THIN_BORDER;
};

export const applyHeaderRow = ({
  row,
  values,
  fill,
  fontSize = 10,
  rowHeight,
}: {
  row: Worksheet['lastRow'];
  values: Array<string | number>;
  fill: Fill;
  fontSize?: number;
  rowHeight?: number;
}) => {
  if (!row) return;

  values.forEach((value, index) => {
    applyHeaderCell({
      cell: row.getCell(index + 1),
      value,
      font: { name: 'Arial', size: fontSize, bold: true, color: { argb: 'FFFFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      fill,
    });
  });

  if (rowHeight) {
    row.height = rowHeight;
  }
};
