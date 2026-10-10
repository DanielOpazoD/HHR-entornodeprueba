import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrDocumentKey } from './cudyrSourceIdentity';

const labels = {
  cma_pabellon: 'CMA · Pabellón',
  cma_hospitalizados: 'CMA · Hospitalizados',
  cma: 'CMA · ubicación no informada',
  uea: 'Urgencias / UEA',
  cuna: 'Cuna RN sano',
  under_eight_hours: 'Hospitalización < 8 horas',
  manual: 'Otra excepción manual',
  other: 'Otras exclusiones',
};
type Reason = keyof typeof labels;
const reason = (row: CudyrReportRow): Reason => {
  if (row.exclusion?.reason === 'under_eight_hours') return 'under_eight_hours';
  if (row.exclusion?.reason === 'healthy_crib') return 'cuna';
  if (row.exclusion?.reason === 'not_hospitalized') return 'manual';
  if (row.exclusion?.reason === 'cma' || row.modality === 'cma') {
    const bed = row.bedName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return bed.includes('pabellon')
      ? 'cma_pabellon'
      : bed.includes('hospitaliz')
        ? 'cma_hospitalizados'
        : 'cma';
  }
  if (row.modality === 'cuna') return 'cuna';
  if (row.modality === 'uea') return 'uea';
  if (/menor de 8|<\s*8|menos de 8/i.test(row.eligibilityReason)) return 'under_eight_hours';
  return row.exclusion?.reason ? 'manual' : 'other';
};
const person = (row: CudyrReportRow) => {
  const document = cudyrDocumentKey(row.rut);
  // Historical newborns may share their mother's document; never merge them with her.
  const newborn = /^rn\b/i.test(row.patientName.trim()) || row.modality === 'cuna';
  return document && !newborn ? `doc:${document}` : `episode:${row.clinicalEpisodeId || row.key}`;
};
/** Mutually exclusive reasons per patient-day; a person may have different reasons on other days. */
export const cudyrExclusionSummary = (rows: CudyrReportRow[]) => {
  const excluded = [
    ...new Map(
      rows
        .filter(r => r.eligibility === 'no_elegible' && !r.resolvedSystemDeparture)
        .map(r => [r.key, r])
    ).values(),
  ];
  const summarize = (items: CudyrReportRow[]) => ({
    patientDays: items.length,
    patients: new Set(items.map(person)).size,
    withCudyr: items.filter(r => r.evaluation !== null).length,
  });
  return {
    ...summarize(excluded),
    groups: (Object.entries(labels) as [Reason, string][])
      .map(([key, label]) => ({
        key,
        label,
        rows: excluded.filter(r => reason(r) === key),
        ...summarize(excluded.filter(r => reason(r) === key)),
      }))
      .filter(group => group.patientDays > 0),
  };
};
