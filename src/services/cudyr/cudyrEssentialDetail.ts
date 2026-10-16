import { cudyrExcelMoment, cudyrExcelDateText } from './cudyrExcelDates';
import type { Worksheet } from 'exceljs';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrControlStatus } from './cudyrDailyControl';
import { CUDYR_ELIGIBILITY_LABELS, CUDYR_MODALITY_LABELS } from './cudyrReportPresentation';

/** Below the unchanged daily grid; strings stay literal, never executable Excel formulas. */
export const addCudyrEssentialDetail = (sheet: Worksheet, rows: CudyrReportRow[]) => {
  const headers = [
    'Cama · Eloísa',
    'Tipo de cama',
    'Paciente',
    'RUT o documento',
    'Categoría',
    'Ingreso hospitalario · Rapa Nui',
    'Registro CUDYR · autor / fecha y hora',
    'Estado CUDYR',
    'Elegibilidad',
    'Criterio / motivo de exclusión',
  ];
  const widths = [28, 22, 34, 20, 11, 25, 32, 25, 18, 46];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.mergeCells('A23:J23');
  sheet.getCell('A23').value =
    'Detalle del censo · excluidos y casos por revisar fuera del cumplimiento';
  sheet.getCell('A23').font = { bold: true, size: 11 };
  sheet.getRow(24).values = headers;
  sheet.getRow(24).height = 32;
  sheet.getRow(24).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  rows
    .filter(row => !row.resolvedSystemDeparture)
    .forEach((row, index) => {
      const detail = sheet.getRow(25 + index);
      detail.values = [
        row.bedName || row.bedId,
        row.modality === 'hospitalizacion' && row.group !== 'sin_grupo'
          ? row.group === 'intermedia'
            ? 'Cama intermedia'
            : 'Cama media'
          : CUDYR_MODALITY_LABELS[row.modality],
        row.patientName,
        row.rut,
        row.evaluation?.category || null,
        row.hospitalAdmissionAt ? cudyrExcelMoment(row.hospitalAdmissionAt) : 'Por confirmar',
        row.evaluation
          ? [
              row.evaluation.author.trim(),
              row.evaluation.recordedAt && cudyrExcelMoment(row.evaluation.recordedAt),
            ]
              .filter(Boolean)
              .join('\n') || 'No informado'
          : null,
        row.eligibility === 'no_elegible' && !row.evaluation
          ? 'No aplica'
          : cudyrControlStatus(row),
        CUDYR_ELIGIBILITY_LABELS[row.eligibility],
        cudyrExcelDateText(row.eligibilityReason),
      ];
      detail.eachCell(cell => {
        cell.font = { size: 11, color: { argb: 'FF000000' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        if (typeof cell.value === 'string') cell.numFmt = '@';
      });
      let lines = 1;
      detail.eachCell((cell, column) => {
        const text = String(cell.value ?? '');
        lines = Math.max(
          lines,
          text
            .split('\n')
            .reduce(
              (sum, line) => sum + Math.max(1, Math.ceil(line.length / (widths[column - 1] - 2))),
              0
            )
        );
      });
      detail.height = Math.max(36, lines * 15 + 8);
    });
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 0 }];
  sheet.autoFilter = { from: 'A24', to: `J${Math.max(24, sheet.rowCount)}` };
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: false,
    scale: 100,
    fitToWidth: 0,
    fitToHeight: 0,
    printArea: `A1:J${sheet.rowCount}`,
  };
};
