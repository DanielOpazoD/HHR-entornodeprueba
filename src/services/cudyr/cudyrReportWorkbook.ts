import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { addCudyrSupplementWorkbook } from './cudyrSupplementWorkbook';
import type { CudyrReportDataset, CudyrReportExportMode } from '@/types/domain/cudyrReport';
import { buildCudyrWorkbook } from './cudyrWorkbookBuilder';
import { cudyrReportTotals } from './cudyrReportModel';
import { CATEGORIES } from './cudyrWorkbookSections';
import type { CategoryCounts } from './cudyrSummary';
import { addCudyrReportContextTable } from './cudyrReportContextTable';
import { addCudyrReportTables } from './cudyrReportWorkbookTables';
import { addCudyrStatisticsTables } from './cudyrStatisticsWorkbook';
import { addCudyrDataSheet } from './cudyrDataSheet';
import { XLSX_MIME_TYPE, validateExcelExport } from '@/services/exporters/excelValidation';
import { recordE2EDownloadArtifact } from '@/shared/runtime/e2eRuntime';

export const buildCudyrReportWorkbook = async (
  data: CudyrReportDataset,
  supplements?: ArchivedCudyrSupplement[],
  mode: CudyrReportExportMode = 'statistics'
) => {
  const [year, month] = data.from.split('-').map(Number);
  const dates = [
    ...new Set([
      ...data.coverage.filter(d => d.state === 'disponible').map(d => d.date),
      ...data.rows.map(row => row.date),
    ]),
  ].sort();
  const summary = (rows: typeof data.rows) => {
    const totals = cudyrReportTotals(rows);
    // Adapter for the original workbook formula layout only. "uti" is not a classification rule.
    const counts: CategoryCounts = {
      uti: Object.fromEntries(
        CATEGORIES.map(cat => [cat, totals.categories[cat].intermedia])
      ) as CategoryCounts['uti'],
      media: Object.fromEntries(
        CATEGORIES.map(cat => [cat, totals.categories[cat].media])
      ) as CategoryCounts['media'],
    };
    return {
      counts,
      utiTotal: Object.values(counts.uti).reduce((a, b) => a + b, 0),
      mediaTotal: Object.values(counts.media).reduce((a, b) => a + b, 0),
      occupiedCount: totals.eligible,
      categorizedCount: totals.categorized,
    };
  };
  const total = summary(data.rows);
  const { workbook } = await buildCudyrWorkbook({
    year,
    month,
    endDate: data.to,
    monthlySummary: {
      year,
      month,
      dailySummaries: dates.map(date => ({
        date,
        ...summary(data.rows.filter(row => row.date === date)),
      })),
      totals: total.counts,
      utiTotal: total.utiTotal,
      mediaTotal: total.mediaTotal,
      totalOccupied: total.occupiedCount,
      totalCategorized: total.categorizedCount,
    },
  });
  workbook.created = new Date(data.generatedAt);
  const preliminary =
    data.issues.length > 0 ||
    data.coverage.some(day => day.state !== 'disponible') ||
    data.rows.some(
      row =>
        row.eligibility === 'por_revisar' ||
        !['registrado', 'sin_registro_observado'].includes(row.cudyrStatus)
    );
  workbook.worksheets.forEach(sheet => {
    sheet.pageSetup = {
      ...sheet.pageSetup,
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      printArea: `A1:D${sheet.rowCount}`,
    };
    sheet.getCell('B3').value = 'INTERMEDIAS';
    sheet.getCell('C3').value = 'MEDIAS';
    sheet.getColumn(1).width = 39;
    sheet.getColumn(2).width = 19;
    sheet.getColumn(3).width = 19;
    sheet.getColumn(4).width = 17;
    sheet.eachRow(row => {
      if (row.getCell(1).value === 'Camas Ocupadas')
        row.getCell(1).value = 'Pacientes-día elegibles conocidos';
      if (row.getCell(1).value === 'Indice de Categorizacion')
        row.getCell(1).value = 'Categorizados / elegibles conocidos';
    });
    sheet.getCell('A2').value = preliminary
      ? 'REVISIÓN PENDIENTE · consultar Cobertura y Detalle diario'
      : 'Consultar metodología y exclusiones';
    sheet.mergeCells('A2:D2');
    sheet.getCell('A2').font = { bold: true, color: { argb: 'FF92400E' } };
  });
  workbook.worksheets[0].getCell('A1').value = `CUDYR · ${data.from} a ${data.to}`;
  if (mode === 'audit' && data.exclusions?.length) {
    addCudyrDataSheet(
      workbook,
      'Revisión elegibilidad',
      [
        'Fecha',
        'Episodio',
        'Motivo',
        'Observación',
        'Origen',
        'Autor',
        'Fecha revisión',
        'Versión',
      ],
      data.exclusions.map(item => [
        item.date,
        item.clinicalEpisodeId,
        item.reason || 'Exclusión retirada',
        item.note,
        item.source,
        item.updatedBy.name,
        item.updatedAt,
        item.revision,
      ])
    );
  }
  if (mode === 'audit') {
    addCudyrReportTables(workbook, data);
    addCudyrReportContextTable(workbook, data);
  } else {
    addCudyrStatisticsTables(workbook, data);
  }
  const totals = cudyrReportTotals(data.rows);
  addCudyrDataSheet(
    workbook,
    'Metodología',
    ['Concepto', 'Definición o valor'],
    [
      ['Generado en HHR (ISO)', data.generatedAt],
      ['Período', data.from + ' a ' + data.to],
      ['Exportación', mode === 'audit' ? 'Auditoría completa' : 'Estadística simplificada'],
      ['Estado', preliminary ? 'Revisión pendiente' : 'Lectura completa'],
      ['Filas', totals.rows],
      ['Elegibles conocidos', totals.eligible],
      ['Categorizados elegibles', totals.categorized],
      ['Elegibles sin resultado confirmado', totals.withoutConfirmedResult],
      ['No elegibles', totals.excluded],
      ['Elegibilidad por revisar', totals.review],
      [
        'Unidad de conteo',
        'Un episodio por día censal. Las versiones y múltiples aplicaciones no multiplican pacientes-día.',
      ],
      ['Medias', 'NEO 1, NEO 2 y H1C1 a H6C2.'],
      ['Intermedias', 'R1, R2, R3 y R4. No depende de UPC ni de sus cambios.'],
      [
        'Exclusiones',
        'Cunas y toda modalidad CMA, según contexto del día. Se conservan en el detalle.',
      ],
      [
        'Turno',
        'Regla HHR vigente: aplicaciones entre 00:01 y antes de 12:00 se atribuyen al día censal previo en Pacific/Easter.',
      ],
      [
        'Referencia de cama',
        'Instante original del resultado seleccionado; sin resultado, corte HHR 01:00 del día siguiente. Intervalos de Eloísa si están comprobados; de lo contrario, contexto HHR del día.',
      ],
      [
        'Ingreso',
        'Regla HHR de 8 horas al corte. Transición cuna/CMA a hospitalización sin inicio de horas elegibles definido queda por revisar.',
      ],
      [
        'Datos ausentes',
        'Sin registro observado no prueba incumplimiento: la fuente puede exponer sólo parte del historial. No se crean pacientes-día para censos ausentes.',
      ],
      [
        'Autor',
        'El autor del CUDYR, el sincronizador y quien guardó el censo son identidades distintas. Vacío significa no informado.',
      ],
      [
        'Altas',
        'Egreso del sistema, fecha de clasificación, epicrisis y salida física verificada se conservan separados. Corrección manual con identidad, revisión y motivo.',
      ],
      [
        'Horas',
        'Campos ISO conservan el huso original. Fechas/horas de alta real en Rapa Nui. Hora vacía significa desconocida.',
      ],
      [
        'Pendientes locales',
        'Se revisa sólo la cola de la sesión y dispositivo actuales. No acredita ausencia de pendientes en otros dispositivos.',
      ],
      [
        'Fuente de descarga',
        'Sólo HHR persistido. Descargar o explorar no consulta ni sincroniza Eloísa.',
      ],
      ...data.issues.map(issue => ['Incidencia de lectura', issue]),
    ]
  );
  if (supplements) addCudyrSupplementWorkbook(workbook, supplements, data.from, data.to, mode);
  const label = mode === 'audit' ? 'Auditoria' : 'Estadistica';
  return { workbook, fileName: `CUDYR_${label}_${data.from}_a_${data.to}.xlsx` };
};
export const cudyrReportExcelBlob = async (
  data: CudyrReportDataset,
  supplements?: ArchivedCudyrSupplement[],
  mode: CudyrReportExportMode = 'statistics'
) => {
  const { workbook, fileName } = await buildCudyrReportWorkbook(data, supplements, mode);
  const buffer = await workbook.xlsx.writeBuffer();
  const result = validateExcelExport(buffer, fileName);
  if (!result.valid) throw new Error('No se pudo validar el Excel CUDYR.');
  return { blob: new Blob([buffer], { type: XLSX_MIME_TYPE }), fileName };
};
export const downloadCudyrReport = async (
  data: CudyrReportDataset,
  supplements?: ArchivedCudyrSupplement[],
  mode: CudyrReportExportMode = 'statistics'
) => {
  const { blob, fileName } = await cudyrReportExcelBlob(data, supplements, mode);
  const { saveAs } = await import('file-saver');
  recordE2EDownloadArtifact({ filename: fileName, blobSize: blob.size, blobType: blob.type });
  saveAs(blob, fileName);
  return { outcome: 'success' as const, fileName, byteLength: blob.size };
};
