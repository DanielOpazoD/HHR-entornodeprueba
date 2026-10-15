import { cudyrExcelDate } from './cudyrExcelDates';
import type { Workbook } from 'exceljs';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
export type { CudyrSourceSheet } from './cudyrSourceTypes';
import { getPreviousDay } from '@/utils/clinicalDayUtils';
import { prepareCudyrSourceTable } from './cudyrSourceTable';
import { markCudyrSourceMovements } from './cudyrSourceMovements';
import { validateCudyrSourceSheet } from './cudyrSourceValidation';
import { CUDYR_SOURCE_COLUMNS as columns } from './cudyrSourceColumns';
import { fitCudyrSourceSheet } from './cudyrSourceSheetLayout';

/** Complete calendar-day source view with explicitly linked HHR exclusions annotated. */
export const addCudyrSourceSheets = (
  workbook: Workbook,
  sources: CudyrSourceSheet[],
  reportMonth: string,
  reportRows: CudyrReportDataset['rows'] = []
) => {
  if (!sources.length) {
    workbook.addWorksheet('Eloísa · sin archivo').getCell('A1').value =
      'Informe original de Eloísa no guardado para este período.';
    return;
  }
  const [year, month] = reportMonth.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  sources.forEach((original, index) => {
    const excerpt = original.month === nextMonth;
    // Equal source bytes may have several archive IDs. Normalize only the annotation copy.
    const reportIds = new Set([original.reportId, ...(original.equivalentReportIds || [])]);
    const linkedRows = original.reportId
      ? reportRows.map(row =>
          row.monthlyEvidence && reportIds.has(row.monthlyEvidence.reportId)
            ? { ...row, monthlyEvidence: { ...row.monthlyEvidence, reportId: original.reportId! } }
            : row
        )
      : reportRows;
    const prepared = prepareCudyrSourceTable(original, excerpt, linkedRows);
    const source = prepared.source;
    const sheet = workbook.addWorksheet(
      `Eloísa ${source.month}${sources.filter(s => s.month === source.month).length > 1 ? ` (${index + 1})` : ''}`
    );
    sheet.addRows(source.matrix.rows.map(row => row.map(value => (value === '' ? null : value))));
    Object.entries(source.matrix.formats).forEach(([address, format]) => {
      sheet.getCell(address).numFmt = format;
    });
    source.matrix.merges.forEach(merge => sheet.mergeCells(merge));
    sheet.eachRow(row =>
      row.eachCell(cell => {
        const format = (cell.numFmt || '')
          .replace(/"[^"]*"|\\.|_.|\*./g, '')
          .replace(/\[[^\]]*\]/g, '');
        if (cell.value instanceof Date || (typeof cell.value === 'number' && /[yd]/i.test(format)))
          cell.numFmt = /h|s/i.test(format) ? 'dd-mm-yyyy hh:mm:ss' : 'dd-mm-yyyy';
      })
    );
    if (prepared.patients) {
      markCudyrSourceMovements(
        sheet,
        original,
        prepared.patients,
        linkedRows,
        excerpt,
        prepared.allPatients
      );
      const statusColumn = columns.exclusion;
      prepared.patients.forEach((patient, index) => {
        const excluded = prepared.excludedDates.get(patient.sourceRow);
        const label = prepared.exclusionLabels?.get(patient.sourceRow);
        if (!excluded?.size || !label) return;
        const row = sheet.getRow(index + 2);
        const highlight = (column: number) => {
          row.getCell(column).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF4DC' },
          };
        };
        // Partial exclusion belongs to specific dates, not to the entire episode.
        if (label === 'Excluido') {
          for (let column = 1; column < columns.firstDay; column++) highlight(column);
        }
        for (const day of patient.days.filter(d => !excerpt || d.sourceDay === 1)) {
          if (!excluded.has(day.sourceDate)) continue;
          const column = columns.firstDay + day.sourceDay - 1;
          if (day.originalValue.trim()) highlight(column);
          const cell = row.getCell(column);
          cell.note = `${typeof cell.note === 'string' ? cell.note + '\n' : ''}${prepared.exclusionReasons?.get(patient.sourceRow)?.get(day.sourceDate)}. Aplicación ${cudyrExcelDate(day.sourceDate)} → turno noche ${cudyrExcelDate(getPreviousDay(day.sourceDate))}. Se conserva el valor de Eloísa.`;
        }
        highlight(statusColumn);
        row.getCell(statusColumn).font = { bold: true, color: { argb: 'FF854D0E' } };
        row.getCell(statusColumn).note = [...excluded]
          .sort()
          .map(
            date =>
              `${prepared.exclusionReasons?.get(patient.sourceRow)?.get(date)}: aplicación ${cudyrExcelDate(date)} → turno noche ${cudyrExcelDate(getPreviousDay(date))}`
          )
          .join('\n');
      });
      sheet.views = [{ state: 'frozen', xSplit: 4, ySplit: 1, topLeftCell: 'E2' }];
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: prepared.patients.length + 1, column: sheet.columnCount },
      };
      sheet.getRow(1).font = { bold: true };
      const days = prepared.patients[0]?.days.filter(d => !excerpt || d.sourceDay === 1) || [];
      for (const day of days) {
        sheet.getCell(1, columns.firstDay + day.sourceDay - 1).note =
          `Fecha de aplicación en Eloísa: ${cudyrExcelDate(day.sourceDate)}. Corresponde al turno nocturno del ${cudyrExcelDate(getPreviousDay(day.sourceDate))}. Los símbolos de ingreso/egreso usan la fecha real del movimiento.`;
      }
      sheet.pageSetup.printTitlesRow = '1:1';
    }
    validateCudyrSourceSheet(sheet, original, excerpt);
    fitCudyrSourceSheet(sheet, source.matrix);
    sheet.getCell('A1').note =
      `Archivo original: ${source.file.name}\nHoja: ${source.matrix.sheet}\nSHA-256: ${source.file.sha256}` +
      (prepared.patients
        ? '\nPacientes y valores de Eloísa conservados en el período mostrado; exclusiones confirmadas en HHR resaltadas. Encabezado único y símbolos añadidos desde HHR. ' +
          prepared.label
        : '') +
      (excerpt
        ? '\nExtracto: solo el día 1 y sus filas con valores; archivo original guardado sin cambios.'
        : '');
    sheet.pageSetup = {
      ...sheet.pageSetup,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  });
};
