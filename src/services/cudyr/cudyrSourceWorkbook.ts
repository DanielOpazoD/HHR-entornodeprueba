import type { Workbook } from 'exceljs';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
export type { CudyrSourceSheet } from './cudyrSourceTypes';
import { getNextDay, getPreviousDay } from '@/utils/clinicalDayUtils';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { prepareCudyrSourceTable } from './cudyrSourceTable';
import { markCudyrSourceMovements } from './cudyrSourceMovements';
import { fitCudyrSourceSheet } from './cudyrSourceSheetLayout';
import {
  callCudyrArchive,
  loadCudyrSupplements,
  type ArchivedCudyrSupplement,
} from './cudyrSupplementService';

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
    const prepared = prepareCudyrSourceTable(original, excerpt, reportRows);
    const source = prepared.source;
    const sheet = workbook.addWorksheet(
      `Eloísa ${source.month}${sources.filter(s => s.month === source.month).length > 1 ? ` (${index + 1})` : ''}`
    );
    sheet.addRows(source.matrix.rows.map(row => row.map(value => (value === '' ? null : value))));
    Object.entries(source.matrix.formats).forEach(([address, format]) => {
      sheet.getCell(address).numFmt = format;
    });
    source.matrix.merges.forEach(merge => sheet.mergeCells(merge));
    if (prepared.patients) {
      markCudyrSourceMovements(
        sheet,
        original,
        prepared.patients,
        reportRows,
        excerpt,
        prepared.allPatients
      );
      const statusColumn = sheet.columnCount;
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
          for (let column = 1; column <= 7; column++) highlight(column);
        }
        for (const day of patient.days.filter(d => !excerpt || d.sourceDay === 1)) {
          if (!excluded.has(day.sourceDate)) continue;
          const column = 7 + day.sourceDay;
          if (day.originalValue.trim()) highlight(column);
          const cell = row.getCell(column);
          cell.note = `${typeof cell.note === 'string' ? cell.note + '\n' : ''}${prepared.exclusionReasons?.get(patient.sourceRow)?.get(day.sourceDate)}. Aplicación ${day.sourceDate} → turno noche ${getPreviousDay(day.sourceDate)}. Se conserva el valor de Eloísa.`;
        }
        highlight(statusColumn);
        row.getCell(statusColumn).font = { bold: true, color: { argb: 'FF854D0E' } };
        row.getCell(statusColumn).note = [...excluded]
          .sort()
          .map(
            date =>
              `${prepared.exclusionReasons?.get(patient.sourceRow)?.get(date)}: aplicación ${date} → turno noche ${getPreviousDay(date)}`
          )
          .join('\n');
      });
      sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1, topLeftCell: 'D2' }];
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: prepared.patients.length + 1, column: sheet.columnCount },
      };
      sheet.getRow(1).font = { bold: true };
      const days = prepared.patients[0]?.days.filter(d => !excerpt || d.sourceDay === 1) || [];
      for (const day of days) {
        sheet.getCell(1, 7 + day.sourceDay).note =
          `Fecha de aplicación en Eloísa: ${day.sourceDate}. Corresponde al turno nocturno del ${getPreviousDay(day.sourceDate)}. Los símbolos de ingreso/egreso usan la fecha real del movimiento.`;
      }
      sheet.pageSetup.printTitlesRow = '1:1';
    }
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

export const selectCudyrSourceReports = (
  data: CudyrReportDataset,
  reports: ArchivedCudyrSupplement[]
) => {
  const used = new Set(
    data.rows.flatMap(row => (row.monthlyEvidence ? [row.monthlyEvidence.reportId] : []))
  );
  if ([...used].some(id => !reports.some(report => report.id === id)))
    throw new Error(
      'Falta un informe original utilizado en este período. Actualice antes de descargar.'
    );
  const month = data.from.slice(0, 7);
  const current = reports
    .filter(report => report.month === month)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const selected = reports.filter(report => used.has(report.id));
  if (!selected.some(report => report.month === month) && current[0]) selected.push(current[0]);
  const hashes = new Set<string>();
  return selected
    .sort((a, b) => a.month.localeCompare(b.month) || a.importedAt.localeCompare(b.importedAt))
    .filter(report => {
      if (hashes.has(report.file.sha256)) return false;
      hashes.add(report.file.sha256);
      return true;
    });
};

const readSourceMatrix = (
  buffer: ArrayBuffer,
  signal: AbortSignal
): Promise<CudyrSourceSheet['matrix']> => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cudyrSupplement.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error('Consulta cancelada.'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Tiempo de lectura del informe agotado.'));
    }, 10000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error('No se pudo leer el informe original.'));
    };
    worker.onmessage = event => {
      finish();
      if (event.data.kind === 'workbook' && event.data.matrix) resolve(event.data.matrix);
      else reject(new Error(event.data.error || 'Informe original no válido.'));
    };
    worker.postMessage({ buffer, kind: 'workbook' }, [buffer]);
  });
};

export const loadCudyrSourceSheets = async (data: CudyrReportDataset, signal: AbortSignal) => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const check = () => {
    signal.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió.');
  };
  check();
  const reports = await loadCudyrSupplements(data.from, getNextDay(data.to), signal);
  check();
  const selected = selectCudyrSourceReports(data, reports);
  const sources: CudyrSourceSheet[] = [];
  for (const archive of selected) {
    check();
    const file = await callCudyrArchive<ArchivedCudyrSupplement['file'] & { base64: string }>(
      'readCudyrHistory',
      { kind: 'monthly-supplement-file', id: archive.id }
    );
    check();
    if (
      file.sha256 !== archive.file.sha256 ||
      typeof file.base64 !== 'string' ||
      file.base64.length > 349528
    )
      throw new Error('No se pudo verificar el informe original.');
    const buffer = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)).buffer;
    sources.push({
      month: archive.month,
      reportId: archive.id,
      file,
      matrix: await readSourceMatrix(buffer, signal),
    });
  }
  check();
  return sources;
};
