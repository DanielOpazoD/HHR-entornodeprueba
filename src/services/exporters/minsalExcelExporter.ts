/**
 * MINSAL Excel Exporter
 * Exports hospital statistics to Excel format compatible with DEIS reporting
 */

import { MinsalStatistics, DailyStatsSnapshot } from '@/types/minsalTypes';
import { createWorkbook } from './excelUtils';
import { downloadWorkbookFile, type DownloadWorkbookOutcome } from './excelFileDownload';

/**
 * Export MINSAL statistics to Excel workbook
 */
export async function exportMinsalToExcel(
  stats: MinsalStatistics,
  trendData: DailyStatsSnapshot[]
): Promise<DownloadWorkbookOutcome> {
  const workbook = await createWorkbook();
  workbook.creator = 'Hospital Hanga Roa';
  workbook.created = new Date();

  // ===== Sheet 1: Resumen de Indicadores =====
  const summarySheet = workbook.addWorksheet('Resumen MINSAL');

  // Title
  summarySheet.mergeCells('A1:D1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = 'ESTADÍSTICAS MINSAL/DEIS - HOSPITAL HANGA ROA';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  // Period info
  summarySheet.getCell('A3').value = 'Período:';
  summarySheet.getCell('B3').value = `${stats.periodStart} a ${stats.periodEnd}`;
  summarySheet.getCell('A4').value = 'Total Días:';
  summarySheet.getCell('B4').value = stats.totalDays;

  // Main indicators
  const indicatorStart = 6;
  const indicators = [
    ['INDICADOR', 'VALOR', 'DESCRIPCIÓN'],
    ['Días Cama Disponibles', stats.diasCamaDisponibles, 'Total de días-cama ofertados'],
    ['Días Cama Ocupados', stats.diasCamaOcupados, 'Total de días-cama utilizados'],
    ['Tasa de Ocupación (%)', stats.tasaOcupacion, 'Índice Ocupacional MINSAL'],
    [
      'Promedio Días Estada',
      stats.promedioDiasEstada,
      'Σ días de estada de egresados del período / egresos del período',
    ],
    ['Egresos Total', stats.egresosTotal, 'Total de salidas del período'],
    ['Egresos Vivos', stats.egresosVivos, 'Altas de pacientes vivos'],
    ['Egresos Fallecidos', stats.egresosFallecidos, 'Muertes intrahospitalarias'],
    ['Egresos Traslados', stats.egresosTraslados, 'Traslados a otros centros'],
    ['Mortalidad Hospitalaria (%)', stats.mortalidadHospitalaria, 'Tasa de letalidad'],
    ['Índice de Rotación', stats.indiceRotacion, 'Egresos/cama/mes'],
  ];

  indicators.forEach((row, index) => {
    const rowNum = indicatorStart + index;
    summarySheet.getCell(`A${rowNum}`).value = row[0];
    summarySheet.getCell(`B${rowNum}`).value = row[1];
    summarySheet.getCell(`C${rowNum}`).value = row[2];

    if (index === 0) {
      // Header row
      ['A', 'B', 'C'].forEach(col => {
        const cell = summarySheet.getCell(`${col}${rowNum}`);
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0284C7' },
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });
    }
  });

  // Column widths
  summarySheet.columns = [{ width: 30 }, { width: 15 }, { width: 35 }, { width: 15 }];

  // ===== Sheet 2: Detalle por Especialidad =====
  const specialtySheet = workbook.addWorksheet('Por Especialidad');

  // Headers
  const specialtyHeaders = [
    'Especialidad',
    'Pacientes del último registro',
    'Egresos del período',
    'Fallecidos',
    'Días-cama del período',
    'Contribución (%)',
    'Mortalidad del período (%)',
    'Estada media de egresos (días)',
    'Rango estada egresos',
  ];

  const headerRow = specialtySheet.addRow(specialtyHeaders);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0284C7' },
    };
    cell.alignment = { horizontal: 'center' };
  });

  // Data rows
  stats.porEspecialidad.forEach(spec => {
    specialtySheet.addRow([
      spec.specialty,
      spec.pacientesActuales,
      spec.egresos,
      spec.fallecidos,
      spec.diasOcupados,
      spec.contribucionRelativa.toFixed(1),
      spec.tasaMortalidad.toFixed(1),
      spec.promedioDiasEstada.toFixed(2),
      spec.promedioDiasEstadaMinima !== undefined && spec.promedioDiasEstadaMaxima !== undefined
        ? `${spec.promedioDiasEstadaMinima.toFixed(1)} - ${spec.promedioDiasEstadaMaxima.toFixed(1)} días`
        : '—',
    ]);
  });

  specialtySheet.addRow([
    'Total',
    stats.pacientesActuales,
    stats.egresosVivos + stats.egresosFallecidos,
    stats.egresosFallecidos,
    stats.diasCamaOcupados,
    '100.0',
    stats.mortalidadHospitalaria.toFixed(1),
    stats.promedioDiasEstada.toFixed(2),
    stats.promedioDiasEstadaMinima !== undefined && stats.promedioDiasEstadaMaxima !== undefined
      ? `${stats.promedioDiasEstadaMinima.toFixed(1)} - ${stats.promedioDiasEstadaMaxima.toFixed(1)} días`
      : '—',
  ]);

  // Column widths
  specialtySheet.columns = [
    { width: 20 },
    { width: 18 },
    { width: 10 },
    { width: 12 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 18 },
    { width: 22 },
  ];

  // ===== Sheet 3: CMA / Hospitalización Diurna =====
  const cmaSheet = workbook.addWorksheet('CMA');
  const cmaHeaders = [
    'Especialidad',
    'Total CMA/PMA',
    'Cirugía Mayor Ambulatoria',
    'Procedimiento Médico Ambulatorio',
  ];
  const cmaHeaderRow = cmaSheet.addRow(cmaHeaders);
  cmaHeaderRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' },
    };
    cell.alignment = { horizontal: 'center' };
  });

  stats.cma?.porEspecialidad.forEach(row => {
    cmaSheet.addRow([
      row.specialty,
      row.total,
      row.cirugiaMayorAmbulatoria,
      row.procedimientoMedicoAmbulatorio,
    ]);
  });

  cmaSheet.addRow([
    'Total',
    stats.cma?.total ?? 0,
    stats.cma?.cirugiaMayorAmbulatoria ?? 0,
    stats.cma?.procedimientoMedicoAmbulatorio ?? 0,
  ]);

  cmaSheet.columns = [{ width: 22 }, { width: 16 }, { width: 28 }, { width: 34 }];

  // ===== Sheet 4: Serie Temporal =====
  const trendSheet = workbook.addWorksheet('Serie Temporal');

  const trendHeaders = [
    'Fecha',
    'Camas Ocupadas',
    'Camas Disponibles',
    'Camas Bloqueadas',
    'Tasa Ocupación (%)',
    'Egresos',
    'Fallecidos',
  ];

  const trendHeaderRow = trendSheet.addRow(trendHeaders);
  trendHeaderRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF22C55E' },
    };
    cell.alignment = { horizontal: 'center' };
  });

  trendData.forEach(day => {
    trendSheet.addRow([
      day.date,
      day.ocupadas,
      day.disponibles,
      day.bloqueadas,
      day.tasaOcupacion,
      day.egresos,
      day.fallecidos,
    ]);
  });

  trendSheet.columns = [
    { width: 12 },
    { width: 15 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 12 },
  ];

  const fileName = `Estadisticas_MINSAL_${stats.periodStart}_${stats.periodEnd}.xlsx`;
  return downloadWorkbookFile({
    workbook,
    filename: fileName,
    successLogMessage: byteLength =>
      `📥 MINSAL Excel descargado: ${fileName} (${byteLength} bytes)`,
  });
}

export default exportMinsalToExcel;
