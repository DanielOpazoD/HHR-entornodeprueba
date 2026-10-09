import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { CUDYR_STATUS_LABELS } from './cudyrReportPresentation';

export const cudyrEligibilityOrigin = (row: CudyrReportRow): string => {
  if (row.exclusion?.reason) return 'Decisión manual';
  if (row.correction?.actualDischarge && row.eligibilityReason.startsWith('Alta real'))
    return 'Alta real verificada manualmente';
  if (row.verifiedContext) return 'Conciliación documental verificada';
  return row.contextSource === 'eloisa_interval' ? 'Automático · Eloísa' : 'Automático · censo HHR';
};
export const cudyrControlStatus = (row: CudyrReportRow): string =>
  row.monthlyEvidence?.state === 'conflict' && row.cudyrStatus === 'por_revisar' && row.evaluation
    ? 'Registrado · categoría por confirmar'
    : row.cudyrStatus === 'registrado'
      ? CUDYR_STATUS_LABELS.registrado
      : row.applicationPending
        ? 'Pendiente de aplicación'
        : row.cudyrStatus === 'sin_registro_observado'
          ? 'No registrado'
          : row.cudyrStatus === 'sin_captura'
            ? 'Verificación pendiente'
            : CUDYR_STATUS_LABELS[row.cudyrStatus];

export const cudyrCompactMoment = (value?: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
};
