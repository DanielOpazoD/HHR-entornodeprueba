import type { Worksheet } from 'exceljs';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { generateDateRange } from '@/utils/dateRangeUtils';
import { recordE2EDownloadArtifact } from '@/shared/runtime/e2eRuntime';
import { XLSX_MIME_TYPE, validateExcelExport } from '@/services/exporters/excelValidation';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { cudyrCensusAccepted } from './cudyrCensusApproval';
import { cudyrArchiveCoverage } from './cudyrArchiveCoverage';
import { cudyrReportTotals } from './cudyrReportModel';
import { buildCudyrWorkbook } from './cudyrWorkbookBuilder';
import { cudyrWorkbookSummary } from './cudyrWorkbookSummary';
import { formatDateDMY } from './cudyrWorkbookSections';
import { addCudyrEssentialDetail } from './cudyrEssentialDetail';
import {
  addCudyrSourceSheets,
  loadCudyrSourceSheets,
  type CudyrSourceSheet,
} from './cudyrSourceWorkbook';

const note = (sheet: Worksheet, row: number, value: string, height = 30) => {
  sheet.mergeCells(`A${row}:D${row}`);
  const cell = sheet.getCell(`A${row}`);
  cell.value = value;
  cell.font = { size: 10, color: { argb: 'FF475569' } };
  cell.alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(row).height = height;
};

/** Same report rows as the screen: no reads or new eligibility decisions during download. */
export const buildCudyrEssentialWorkbook = async (
  data: CudyrReportDataset,
  sources?: CudyrSourceSheet[]
) => {
  if (data.issues.length || data.coverage.some(day => day.state === 'error'))
    throw new Error('No se completó la lectura. Actualice antes de descargar.');
  const [year, month] = data.from.split('-').map(Number);
  const dates = generateDateRange(year, month).filter(date => date >= data.from && date <= data.to);
  if (!dates.length || data.from.slice(0, 7) !== data.to.slice(0, 7))
    throw new Error('Seleccione un período dentro del mismo mes.');
  const byDay = new Map(dates.map(date => [date, data.rows.filter(row => row.date === date)]));
  const total = cudyrWorkbookSummary([...byDay.values()].flat());
  const { workbook, fileName } = await buildCudyrWorkbook({
    year,
    month,
    endDate: data.to,
    afterSummary: sources ? workbook => addCudyrSourceSheets(workbook, sources) : undefined,
    monthlySummary: {
      year,
      month,
      dailySummaries: dates.map(date => ({ date, ...cudyrWorkbookSummary(byDay.get(date)!) })),
      totals: total.counts,
      utiTotal: total.utiTotal,
      mediaTotal: total.mediaTotal,
      totalOccupied: total.occupiedCount,
      totalCategorized: total.categorizedCount,
    },
  });
  workbook.created = new Date(data.generatedAt);
  const verification = cudyrArchiveCoverage(data, new Date(data.generatedAt));
  const states = dates.map(date => {
    const day = data.coverage.find(item => item.date === date);
    const rows = byDay.get(date)!;
    const counts = cudyrReportTotals(rows);
    const pending = resolveCudyrPendingStatus(date, new Date(data.generatedAt)).phase !== 'overdue';
    const state =
      !day || day.state !== 'disponible'
        ? 'Sin censo · cálculo incompleto'
        : pending
          ? 'Ventana de aplicación abierta · fuera del cumplimiento'
          : counts.review
            ? 'Elegibilidad por revisar'
            : !cudyrCensusAccepted(day) ||
                verification.find(item => item.date === date)?.state !== 'complete'
              ? 'Censo o CUDYR por verificar'
              : day.reconstructionApproval
                ? 'Oficial'
                : 'Verificado con Eloísa';
    const sheet = workbook.getWorksheet(formatDateDMY(date))!;
    sheet.getCell('A1').value = `CUDYR · turno noche ${formatDateDMY(date)}`;
    note(sheet, 2, state);
    sheet.getCell('A18').value = 'Cumplimiento · pacientes elegibles';
    sheet.getCell('A19').value = 'Pacientes elegibles';
    sheet.getCell('A20').value = 'Con CUDYR registrado';
    sheet.getCell('A21').value = 'Cumplimiento CUDYR';
    sheet.getCell('B21').value = {
      formula: 'IF(B19=0,"",ROUND(B20/B19*100,0))',
      result: counts.eligible ? Math.round((100 * counts.categorized) / counts.eligible) : '',
    };
    if (pending || ((!day || day.state !== 'disponible') && !rows.length)) {
      sheet.getCell('B19').value = null;
      sheet.getCell('B20').value = null;
      for (let row = 4; row <= 16; row++)
        for (const column of ['B', 'C', 'D']) sheet.getCell(`${column}${row}`).value = null;
    }
    addCudyrEssentialDetail(sheet, rows);
    return { date, state, pending, available: day?.state === 'disponible' };
  });
  workbook.worksheets.forEach(sheet => {
    if (sheet.name.startsWith('Eloísa ')) return;
    sheet.getCell('B3').value = 'Cama intermedia';
    sheet.getCell('C3').value = 'Cama media';
    sheet.getRow(3).height = 30;
    sheet.getRow(3).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getRow(1).height = 38;
    sheet.getCell('A1').alignment = { vertical: 'middle', wrapText: true };
  });
  const summary = workbook.getWorksheet('Resumen CUDYR Mensual')!;
  summary.columns = [34, 22, 22, 14].map(width => ({ width }));
  summary.getCell('A1').value =
    `CUDYR mensual · ${formatDateDMY(data.from)} al ${formatDateDMY(data.to)}`;
  const unresolved = states.filter(
    item => !item.pending && !['Verificado con Eloísa', 'Oficial'].includes(item.state)
  );
  note(
    summary,
    2,
    unresolved.length
      ? `Cálculo con información disponible · ${unresolved.length} días por verificar.`
      : 'Categorías A1–D3 · solo pacientes elegibles con CUDYR registrado'
  );
  summary.getCell('A19').value = 'Cumplimiento acumulado';
  summary.getCell('A20').value = 'Pacientes-día elegibles';
  summary.getCell('A21').value = 'Con CUDYR registrado';
  summary.getCell('A22').value = 'Cumplimiento CUDYR';
  summary.getCell('B22').value = {
    formula: 'IF(B20=0,"",ROUND(B21/B20*100,0))',
    result: total.occupiedCount
      ? Math.round((100 * total.categorizedCount) / total.occupiedCount)
      : '',
  };
  const notes = [
    'Cálculo: CUDYR registrados de elegibles / pacientes-día elegibles. Se suman los días; no se promedian sus porcentajes.',
    'Elegibilidad: más de 8 horas desde el ingreso hospitalario al corte virtual de las 01:00 del día siguiente al censo.',
    'No elegibles: RN sano en cuna; Urgencias/UEA; CMA en pabellón u hospitalización; exclusión manual justificada.',
  ];
  notes.forEach((value, index) => note(summary, 24 + index, value, 34));
  summary.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:D${summary.rowCount}`,
  };
  return { workbook, fileName };
};
export const downloadCudyrEssential = async (data: CudyrReportDataset) => {
  const sources = await loadCudyrSourceSheets(data, new AbortController().signal);
  const { workbook, fileName } = await buildCudyrEssentialWorkbook(data, sources);
  const buffer = await workbook.xlsx.writeBuffer();
  if (!validateExcelExport(buffer, fileName).valid) throw new Error('Excel no válido.');
  const { saveAs } = await import('file-saver');
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  recordE2EDownloadArtifact({ filename: fileName, blobSize: blob.size, blobType: blob.type });
  saveAs(blob, fileName);
};
