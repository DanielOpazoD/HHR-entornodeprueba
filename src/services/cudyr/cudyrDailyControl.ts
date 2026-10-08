import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { CUDYR_STATUS_LABELS } from './cudyrReportPresentation';

export const cudyrEligibilityOrigin = (row: CudyrReportRow): string => {
  if (row.exclusion?.reason) return 'Decisión manual';
  if (row.correction?.actualDischarge && row.eligibilityReason.startsWith('Alta real'))
    return 'Alta real verificada manualmente';
  return row.contextSource === 'eloisa_interval' ? 'Automático · Eloísa' : 'Automático · censo HHR';
};
export const cudyrControlStatus = (row: CudyrReportRow): string =>
  row.cudyrStatus === 'sin_registro_observado'
    ? 'Consultado · sin CUDYR encontrado'
    : row.cudyrStatus === 'sin_captura'
      ? 'Sin consulta confirmada'
      : CUDYR_STATUS_LABELS[row.cudyrStatus];
