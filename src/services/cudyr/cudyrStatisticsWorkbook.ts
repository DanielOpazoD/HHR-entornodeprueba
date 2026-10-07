import type { Workbook } from 'exceljs';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { addCudyrDataSheet } from './cudyrDataSheet';
import {
  CUDYR_GROUP_LABELS,
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
  CUDYR_STATUS_LABELS,
  cudyrMomentLabel,
  cudyrSystemDischargeLabel,
} from './cudyrReportPresentation';

// Source local dates are not instants: joining them must not invent midnight or shift the day.
const localDateTime = (date?: string, time?: string) =>
  date ? `${date} ${time || '(hora no informada)'}` : 'No informado';

export const addCudyrStatisticsTables = (workbook: Workbook, data: CudyrReportDataset) => {
  addCudyrDataSheet(
    workbook,
    'Detalle diario',
    [
      'Fecha censo',
      'Nombre completo',
      'RUT o documento',
      'Diagnóstico',
      'CIE-10',
      'Ingreso fecha y hora',
      'Cama',
      'Servicio',
      'Grupo estadístico',
      'Modalidad',
      'Elegibilidad',
      'Motivo elegibilidad',
      'Estado CUDYR',
      'Categoría',
      'Dependencia',
      'Riesgo',
      'Origen CUDYR',
      'Evaluación fecha y hora · Rapa Nui',
      'Autor CUDYR',
      'Captura fecha y hora · Rapa Nui',
      'Usuario sincronizador',
      'Egreso sistema fecha y hora',
      'Alta real fecha y hora',
      'Alta real revisada por',
      'Revisión alta fecha · Rapa Nui',
      'Revisión alta motivo',
      'Epicrisis médica',
      'Epicrisis enfermería',
      'Registro epicrisis · Rapa Nui',
      'Observaciones',
    ],
    data.rows.map(row => [
      row.date,
      row.patientName,
      row.rut,
      row.diagnosis,
      row.diagnosisCode,
      localDateTime(row.admissionDate, row.admissionTime),
      // Preserve differing source labels in one cell instead of silently dropping one.
      row.bedName && row.bedId && row.bedName !== row.bedId
        ? `${row.bedName} (${row.bedId})`
        : row.bedName || row.bedId,
      row.service,
      CUDYR_GROUP_LABELS[row.group],
      CUDYR_MODALITY_LABELS[row.modality],
      CUDYR_ELIGIBILITY_LABELS[row.eligibility],
      row.eligibilityReason,
      CUDYR_STATUS_LABELS[row.cudyrStatus],
      row.evaluation?.category,
      row.evaluation?.dependencyScore,
      row.evaluation?.riskScore,
      row.evaluation?.source,
      cudyrMomentLabel(row.evaluation?.recordedAt || ''),
      row.evaluation?.author,
      cudyrMomentLabel(row.lastCaptureAt),
      row.captureActor,
      cudyrSystemDischargeLabel(row),
      localDateTime(row.correction?.actualDischarge?.date, row.correction?.actualDischarge?.time),
      row.correction?.updatedBy.name,
      cudyrMomentLabel(row.correction?.updatedAt || ''),
      row.correction?.reason,
      row.medicalEpicrisisStatus,
      row.nursingEpicrisisStatus,
      cudyrMomentLabel(row.epicrisisRegisteredAt),
      row.warnings.join(' | '),
    ])
  );
  addCudyrDataSheet(
    workbook,
    'Cobertura',
    ['Fecha', 'Censo HHR', 'Última sincronización · Rapa Nui'],
    data.coverage.map(day => [day.date, day.state, cudyrMomentLabel(day.lastSyncedAt)])
  );
};
