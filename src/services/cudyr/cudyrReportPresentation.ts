import type { CudyrReportRow, CudyrReportStatus } from '@/types/domain/cudyrReport';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

export const CUDYR_GROUP_LABELS = {
  media: 'Media',
  intermedia: 'Intermedia',
  sin_grupo: 'Sin grupo confirmado',
};
export const CUDYR_MODALITY_LABELS = {
  hospitalizacion: 'Hospitalización',
  cuna: 'Cuna',
  cma: 'CMA',
  desconocida: 'Sin confirmar',
};
export const CUDYR_ELIGIBILITY_LABELS = {
  elegible: 'Elegible',
  no_elegible: 'No elegible',
  por_revisar: 'Por revisar',
};
export const CUDYR_STATUS_LABELS: Record<CudyrReportStatus, string> = {
  registrado: 'Registrado',
  sin_registro_observado: 'Sin registro observado',
  fuente_no_disponible: 'Fuente no disponible',
  sin_captura: 'Sin captura',
  captura_incompleta: 'Captura incompleta',
  guardado_pendiente: 'Guardado pendiente',
  por_revisar: 'Por revisar',
};
export const cudyrMomentLabel = (value: string) => {
  if (!value) return 'No informado';
  if (!Number.isFinite(Date.parse(value))) return value;
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
};
export const cudyrSystemDischargeLabel = (row: CudyrReportRow) =>
  [
    ...new Set(
      row.movements
        .filter(item => ['discharges', 'transfers'].includes(item.section))
        .map(item => `${item.date || 'Fecha no informada'} ${item.time || '(hora no informada)'}`)
    ),
  ].join(' / ');
export interface CudyrReportFilters {
  search: string;
  bed: string;
  service: string;
  group: string;
  modality: string;
  eligibility: string;
  status: string;
}
export const EMPTY_CUDYR_REPORT_FILTERS: CudyrReportFilters = {
  search: '',
  bed: '',
  service: '',
  group: '',
  modality: '',
  eligibility: '',
  status: '',
};
const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.\s-]/g, '');
export const filterCudyrReportRows = (rows: CudyrReportRow[], filters: CudyrReportFilters) =>
  rows.filter(
    row =>
      (!filters.search ||
        fold([row.patientName, row.rut, row.diagnosis, row.clinicalEpisodeId].join(' ')).includes(
          fold(filters.search)
        )) &&
      (!filters.bed || row.bedId === filters.bed) &&
      (!filters.service || row.service === filters.service) &&
      (!filters.group || row.group === filters.group) &&
      (!filters.modality || row.modality === filters.modality) &&
      (!filters.eligibility || row.eligibility === filters.eligibility) &&
      (!filters.status || row.cudyrStatus === filters.status)
  );
