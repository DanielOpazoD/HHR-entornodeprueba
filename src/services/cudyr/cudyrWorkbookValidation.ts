import type { Workbook, Worksheet } from 'exceljs';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { cudyrReportTotals } from './cudyrReportModel';
import { CATEGORIES, formatDateDMY } from './cudyrWorkbookSections';

/** Verify exported totals against HHR and reconcile monthly counts with the daily sheets. */
export const validateCudyrWorkbookTotals = (
  workbook: Workbook,
  data: CudyrReportDataset,
  dates: string[]
) => {
  const fail = () => {
    throw new Error('Los totales del Excel no coinciden con HHR. Actualice antes de descargar.');
  };
  const number = (sheet: Worksheet, address: string) => {
    const cell = sheet.getCell(address);
    const value = cell.formula ? cell.result : cell.value;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') fail();
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) fail();
    return numeric;
  };
  const check = (sheet: Worksheet, rows: CudyrReportDataset['rows'], firstCountRow: number) => {
    const totals = cudyrReportTotals(rows);
    const eligible = number(sheet, `B${firstCountRow}`);
    const categorized = number(sheet, `B${firstCountRow + 1}`);
    if ((eligible ?? 0) !== totals.eligible || (categorized ?? 0) !== totals.categorized) fail();
    const percent = number(sheet, `B${firstCountRow + 2}`);
    if (
      percent !==
      (totals.eligible ? Math.round((100 * totals.categorized) / totals.eligible) : null)
    )
      fail();
    CATEGORIES.forEach((category, index) => {
      const expected = totals.categories[category];
      if (
        (number(sheet, `B${index + 4}`) ?? 0) !== expected.intermedia ||
        (number(sheet, `C${index + 4}`) ?? 0) !== expected.media ||
        (number(sheet, `D${index + 4}`) ?? 0) !== expected.intermedia + expected.media
      )
        fail();
    });
    const intermedia = CATEGORIES.reduce(
      (sum, category) => sum + totals.categories[category].intermedia,
      0
    );
    const media = CATEGORIES.reduce((sum, category) => sum + totals.categories[category].media, 0);
    if (
      (number(sheet, 'B16') ?? 0) !== intermedia ||
      (number(sheet, 'C16') ?? 0) !== media ||
      (number(sheet, 'D16') ?? 0) !== totals.categorized
    )
      fail();
    return { eligible: eligible ?? 0, categorized: categorized ?? 0 };
  };
  let dailyEligible = 0,
    dailyCategorized = 0;
  for (const date of dates) {
    const sheet = workbook.getWorksheet(formatDateDMY(date));
    if (!sheet) return fail();
    const totals = check(
      sheet,
      data.rows.filter(row => row.date === date),
      19
    );
    dailyEligible += totals.eligible;
    dailyCategorized += totals.categorized;
  }
  const summary = workbook.getWorksheet('Resumen CUDYR Mensual');
  if (!summary) return fail();
  const totals = check(
    summary,
    data.rows.filter(row => dates.includes(row.date)),
    20
  );
  if (totals.eligible !== dailyEligible || totals.categorized !== dailyCategorized) fail();
};
