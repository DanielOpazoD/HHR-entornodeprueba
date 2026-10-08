import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { recordE2EDownloadArtifact } from '@/shared/runtime/e2eRuntime';
import { createWorkbook } from '@/services/exporters/excelUtils';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { addCudyrDataSheet } from './cudyrDataSheet';
import { cudyrReportTotals } from './cudyrReportModel';
import { CUDYR_GROUP_LABELS, cudyrMomentLabel } from './cudyrReportPresentation';
import { cudyrControlStatus, cudyrEligibilityOrigin } from './cudyrDailyControl';
import { XLSX_MIME_TYPE, validateExcelExport } from '@/services/exporters/excelValidation';

/** Excluded/review rows never enter the patient sheet; missing CUDYR stays in the denominator. */
export const buildCudyrEssentialWorkbook = async (data: CudyrReportDataset) => {
  if (data.issues.length || data.coverage.some(day => day.state === 'error'))
    throw new Error('No se completó la lectura. Actualice antes de descargar.');
  const workbook = await createWorkbook();
  const totals = cudyrReportTotals(data.rows);
  addCudyrDataSheet(
    workbook,
    'Resumen',
    [
      'Fecha',
      'Elegibles',
      'CUDYR confirmados',
      'Cumplimiento %',
      'Excluidos',
      'Por revisar',
      'Estado del día',
    ],
    [
      ...data.coverage.map(day => {
        const t = cudyrReportTotals(data.rows.filter(row => row.date === day.date));
        return [
          day.date,
          resolveCudyrPendingStatus(day.date, new Date(data.generatedAt)).phase === 'overdue'
            ? t.eligible
            : null,
          t.categorized,
          t.eligible ? Math.round((100 * t.categorized) / t.eligible) : null,
          t.excluded,
          t.review,
          resolveCudyrPendingStatus(day.date, new Date(data.generatedAt)).phase !== 'overdue'
            ? 'Pendiente de aplicación · fuera del cumplimiento'
            : day.state === 'disponible'
              ? 'Evaluable'
              : 'Sin censo · provisional',
        ];
      }),
      [
        'Acumulado',
        totals.eligible,
        totals.categorized,
        totals.eligible ? Math.round((100 * totals.categorized) / totals.eligible) : null,
        totals.excluded,
        totals.review,
        'Solo días con ventana de aplicación terminada',
      ],
    ]
  );
  addCudyrDataSheet(
    workbook,
    'Pacientes elegibles',
    [
      'Fecha censo',
      'Paciente',
      'RUT o documento',
      'Diagnóstico',
      'Cama',
      'Grupo de cama',
      'P. dependencia',
      'P. riesgo',
      'Categoría',
      'Estado CUDYR',
      'Origen CUDYR',
      'Registrado por',
      'Fecha y hora CUDYR · Rapa Nui',
      'Última consulta · Rapa Nui',
      'Criterio de elegibilidad',
    ],
    data.rows
      .filter(row => row.eligibility === 'elegible' && !row.applicationPending)
      .map(row => [
        row.date,
        row.patientName,
        row.rut,
        row.diagnosis,
        row.bedName || row.bedId,
        CUDYR_GROUP_LABELS[row.group],
        row.evaluation?.dependencyScore,
        row.evaluation?.riskScore,
        row.evaluation?.category,
        cudyrControlStatus(row),
        row.evaluation?.source,
        row.evaluation?.author,
        cudyrMomentLabel(row.evaluation?.recordedAt || ''),
        cudyrMomentLabel(row.lastCaptureAt),
        cudyrEligibilityOrigin(row),
      ])
  );
  const summary = workbook.getWorksheet('Resumen')!;
  summary.addRow([]);
  summary.addRow(['Período', `${data.from} a ${data.to}`]);
  summary.addRow(['Generado · Rapa Nui', cudyrMomentLabel(data.generatedAt)]);
  summary.addRow([
    'Cobertura',
    `${data.coverage.filter(d => d.state === 'disponible').length} de ${data.coverage.length} días con censo`,
  ]);
  summary.addRow([
    'Criterio',
    'CUDYR confirmados / pacientes-día elegibles conocidos. No es promedio de porcentajes diarios.',
  ]);
  summary.addRow([
    'Exclusiones',
    'No se incluyen excluidos, casos por revisar ni días pendientes de aplicación. Los antecedentes se conservan en HHR.',
  ]);
  summary.addRow([
    'Datos ausentes',
    'Sin CUDYR encontrado no demuestra que no se realizó. Puntajes vacíos no equivalen a cero.',
  ]);
  summary.addRow([
    'Grupos',
    'Medias: NEO 1–2 y H1C1–H6C2. Intermedias: R1–R4. Independiente de UPC.',
  ]);
  return { workbook, fileName: `CUDYR_${data.from}_a_${data.to}.xlsx` };
};
export const downloadCudyrEssential = async (data: CudyrReportDataset) => {
  const { workbook, fileName } = await buildCudyrEssentialWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  if (!validateExcelExport(buffer, fileName).valid) throw new Error('Excel no válido.');
  const { saveAs } = await import('file-saver');
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  recordE2EDownloadArtifact({ filename: fileName, blobSize: blob.size, blobType: blob.type });
  saveAs(blob, fileName);
};
