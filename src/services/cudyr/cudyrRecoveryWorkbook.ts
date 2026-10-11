import { createWorkbook } from '@/services/exporters/excelUtils';
import { saveAs } from 'file-saver';
import { addCudyrDataSheet } from './cudyrDataSheet';
import {
  CUDYR_RECOVERY_LABELS,
  cudyrRecoveryGuidance,
  type CudyrRecoveryCase,
} from './cudyrRecoveryPlan';
import {
  CUDYR_GROUP_LABELS,
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
} from './cudyrReportPresentation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';

export const buildCudyrRecoveryWorkbook = async (
  data: CudyrReportDataset,
  selected: CudyrRecoveryCase[]
) => {
  if (!selected.length || selected.length > 20) throw new Error('Seleccione entre 1 y 20 casos.');
  const workbook = await createWorkbook();
  addCudyrDataSheet(
    workbook,
    'Alcance',
    ['Campo', 'Valor'],
    [
      [
        'Uso',
        'Lista de búsqueda dirigida. No es el reporte para Estadística ni certifica incumplimientos.',
      ],
      ['Período', `${data.from} a ${data.to}`],
      ['Lectura HHR original', data.generatedAt],
      ['Casos seleccionados', selected.length],
      [
        'Cobertura',
        data.coverage.some(d => d.state !== 'disponible') || data.issues.length
          ? 'Lectura parcial: revisar incidencias en HHR.'
          : 'Censos leídos; no acredita población completa.',
      ],
      [
        'Fechas',
        'Conservar fecha original, desfase y día censal por separado. El turno de fin de mes puede incluir la mañana del mes siguiente.',
      ],
      [
        'Ausencia',
        'No encontrado, fuente incompleta y no aplicado son distintos. No inferir no aplicado por falta de resultados.',
      ],
      [
        'Persistencia',
        'Guardar evidencia por el flujo autorizado antes de exportar Estadística. Este archivo no modifica HHR ni sincroniza Eloísa.',
      ],
    ]
  );
  addCudyrDataSheet(
    workbook,
    'Búsqueda dirigida',
    [
      'Nombre completo',
      'RUT o documento',
      'Episodio',
      'Día censal',
      'Cama',
      'Grupo',
      'Modalidad',
      'Elegibilidad',
      'Diagnóstico',
      'Qué falta cotejar',
      'Categoría conservada',
      'Fuente conservada',
      'Autor conservado',
      'Fecha original ISO',
      'ID aplicación original',
      'Siguiente paso',
    ],
    selected.flatMap(entry =>
      entry.rows.map(({ row, needs }) => [
        entry.patientName,
        entry.document,
        entry.episodeId,
        row.date,
        row.bedId,
        CUDYR_GROUP_LABELS[row.group],
        CUDYR_MODALITY_LABELS[row.modality],
        CUDYR_ELIGIBILITY_LABELS[row.eligibility],
        row.diagnosis,
        needs.map(n => CUDYR_RECOVERY_LABELS[n]).join(' · '),
        row.evaluation?.category,
        row.evaluation?.source,
        row.evaluation?.author,
        row.evaluation?.recordedAt,
        row.evaluation?.sourceEvaluationId,
        cudyrRecoveryGuidance(entry),
      ])
    )
  );
  return workbook;
};
export const downloadCudyrRecoveryPlan = async (
  data: CudyrReportDataset,
  selected: CudyrRecoveryCase[]
) => {
  const workbook = await buildCudyrRecoveryWorkbook(data, selected);
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `CUDYR_Busqueda_${data.from}_a_${data.to}.xlsx`
  );
};
