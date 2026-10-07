import type { Workbook } from 'exceljs';

/** Strings always remain literal cell values, including RUTs and values beginning with "=". */
export const addCudyrDataSheet = (
  workbook: Workbook,
  name: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
) => {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = headers.map(header => ({
    header,
    width: Math.min(42, Math.max(17, header.length + 3)),
  }));
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: Math.min(2, headers.length) }];
  sheet.addRows(rows.map(row => row.map(value => value ?? '')));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: headers.length },
  };
  const title = sheet.getRow(1);
  title.height = 34;
  title.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.eachRow((row, index) => {
    if (index > 1)
      row.eachCell(cell => {
        cell.alignment = { vertical: 'top', wrapText: true };
        if (typeof cell.value === 'string') cell.numFmt = '@';
        if (index % 2 === 0)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
      });
  });
  return sheet;
};
