import type { Worksheet } from 'exceljs';

/** Source widths are a starting point, not a constraint on readable values. */
export const fitCudyrSourceSheet = (
  sheet: Worksheet,
  layout: {
    widths: Array<number | undefined>;
    heights: Array<number | undefined>;
    merges: string[];
  }
) => {
  // Empty spacer rows are not visited by eachRow(), but their original height
  // is part of the source layout too.
  layout.heights.forEach((height, index) => {
    if (height && Number.isFinite(height) && height > 0)
      sheet.getRow(index + 1).height = Math.min(409, height);
  });
  const spans = new Map<string, { first: number; last: number }>();
  layout.merges.forEach(merge => {
    const [start, end = start] = merge.split(':');
    spans.set(start, {
      first: Number(sheet.getCell(start).col),
      last: Number(sheet.getCell(end).col),
    });
  });
  for (let column = 1; column <= sheet.columnCount; column++) {
    const original = layout.widths[column - 1];
    sheet.getColumn(column).width =
      original && Number.isFinite(original) && original > 0 ? Math.min(48, original) : 8;
  }
  const columnsFor = (address: string, column: number) =>
    spans.get(address) || { first: column, last: column };
  const widthFor = ({ first, last }: { first: number; last: number }) => {
    let width = 0;
    for (let column = first; column <= last; column++) width += sheet.getColumn(column).width!;
    return width;
  };
  // Size data columns before spanning titles, so a title cannot unnecessarily
  // widen the ordinal column before the patient/diagnosis columns are fitted.
  for (const merged of [false, true]) {
    sheet.eachRow(row => {
      row.eachCell(cell => {
        if (cell.isMerged !== merged || (merged && cell.master.address !== cell.address)) return;
        const span = columnsFor(cell.address, Number(cell.col));
        const longest = Math.max(...cell.text.split(/\r?\n/).map(line => line.length));
        const desired = Math.min(48, Math.max(8, longest + 2));
        const missing = desired - widthFor(span);
        if (missing > 0) sheet.getColumn(span.first).width! += missing;
      });
    });
  }
  sheet.eachRow(row => {
    let lines = 1;
    row.eachCell(cell => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      cell.alignment = { vertical: 'top', wrapText: true };
      if (typeof cell.value === 'string') cell.numFmt = '@';
      const width = Math.max(1, widthFor(columnsFor(cell.address, Number(cell.col))) - 2);
      lines = Math.max(
        lines,
        cell.text
          .split(/\r?\n/)
          .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0)
      );
    });
    const original = layout.heights[row.number - 1];
    row.height = Math.min(
      409,
      Math.max(18, lines * 15 + 4, original && Number.isFinite(original) ? original : 0)
    );
  });
};
