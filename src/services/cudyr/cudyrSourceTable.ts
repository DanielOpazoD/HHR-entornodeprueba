import { getPreviousDay } from '@/utils/clinicalDayUtils';
import { cudyrExclusionSummary } from './cudyrExclusionSummary';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
import { parseCudyrSupplementMatrix } from './cudyrSupplementParser';

/** Parser joins Jasper page continuations; patient episodes are never deduplicated. */
export const prepareCudyrSourceTable = (
  source: CudyrSourceSheet,
  excerpt: boolean,
  rows: CudyrReportRow[] = []
) => {
  const parsed = parseCudyrSupplementMatrix(source.matrix);
  if (!parsed.ok || parsed.report.month !== source.month) {
    if (excerpt)
      throw new Error('No se pudo aislar el día 1 del informe original del mes siguiente.');
    // Unknown legacy layouts retain their complete original cells and formatting.
    return { source, patients: null, label: '', excludedDates: new Map<number, Set<string>>() };
  }
  const { report } = parsed;
  const excludedDates = new Map<number, Set<string>>();
  const exclusionLabels = new Map<number, string>();
  const exclusionReasons = new Map<number, Map<string, string>>();
  const patients = report.patients.filter(p => {
    const days = p.days.filter(d => !excerpt || d.sourceDay === 1);
    if (excerpt && !days.some(d => d.originalValue)) return false;
    const own = source.reportId
      ? rows.filter(
          r =>
            r.monthlyEvidence?.reportId === source.reportId &&
            r.monthlyEvidence?.sourceRow === p.sourceRow
        )
      : [];
    const episodes = new Set(own.map(r => r.clinicalEpisodeId));
    const excluded = new Set<string>();
    const reasons = new Map<string, string>();
    if (episodes.size === 1 && own.every(r => Boolean(r.clinicalEpisodeId))) {
      for (const day of days) {
        const matches = own.filter(r => r.monthlyEvidence?.sourceDate === day.sourceDate);
        if (
          matches.length &&
          matches.every(
            r =>
              r.eligibility === 'no_elegible' &&
              !r.resolvedSystemDeparture &&
              r.date === getPreviousDay(day.sourceDate) &&
              r.monthlyEvidence?.state !== 'conflict'
          )
        ) {
          excluded.add(day.sourceDate);
          const labels = matches
            .flatMap(r => cudyrExclusionSummary([r]).groups)
            .map(group =>
              group.key.startsWith('cma') ? 'CMA · cirugía mayor ambulatoria' : group.label
            );
          reasons.set(day.sourceDate, [...new Set(labels)].join('; '));
        }
      }
    }
    excludedDates.set(p.sourceRow, excluded);
    exclusionReasons.set(p.sourceRow, reasons);
    const relevant = days.filter(
      d =>
        d.originalValue ||
        own.some(r => !r.resolvedSystemDeparture && r.monthlyEvidence?.sourceDate === d.sourceDate)
    );
    if (excluded.size)
      exclusionLabels.set(
        p.sourceRow,
        relevant.every(d => excluded.has(d.sourceDate)) ? 'Excluido' : 'Exclusión parcial'
      );
    return true;
  });
  const days = report.patients[0].days.filter(d => !excerpt || d.sourceDay === 1);
  const monthName = new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${source.month}-01T00:00:00Z`)
  );
  const label = excerpt
    ? `Día incluido: 01-${source.month.slice(5)}-${source.month.slice(0, 4)}`
    : `${monthName[0].toUpperCase()}${monthName.slice(1)} ${source.month.slice(0, 4)}`;
  const reasonsLabel = (sourceRow: number) => {
    const reason = [...new Set(exclusionReasons.get(sourceRow)?.values())].join('; ');
    return reason ? `${exclusionLabels.get(sourceRow)}: ${reason}` : '';
  };
  return {
    patients,
    allPatients: report.patients,
    label,
    excludedDates,
    exclusionLabels,
    exclusionReasons,
    source: {
      ...source,
      matrix: {
        sheet: source.matrix.sheet,
        rows: [
          [
            'N°',
            'Nombre Paciente',
            'RUN o Nro. Ident.',
            'Exclusión · motivo',
            'Diagnóstico de Ingreso',
            'Fecha de ingreso',
            'Servicio Clínico',
            'Condición Alta',
            ...days.map(d => `Día ${d.sourceDay}`),
          ],
          ...patients.map(p => [
            p.ordinal,
            p.patientName,
            p.document,
            reasonsLabel(p.sourceRow),
            p.diagnosis,
            'No informado',
            p.service,
            p.dischargeCondition,
            ...p.days.filter(d => !excerpt || d.sourceDay === 1).map(d => d.originalValue),
          ]),
          [label],
          [
            'Día = aplicación en Eloísa. CUDYR aplicado en X+1 → turno noche X. ▼ Ingreso · ▲ Egreso: fecha real (Rapa Nui).',
          ],
          [
            'Ámbar: valor de Eloísa excluido del cálculo; motivo junto al nombre. Los egresos resueltos no se colorean. Sin marca no acredita elegibilidad.',
          ],
          [report.establishment],
          [report.generatedLabel],
        ],
        merges: Array.from(
          { length: 5 },
          (_, i) => `A${patients.length + 2 + i}:H${patients.length + 2 + i}`
        ),
        widths: [8, 32, 18, 32, 40, 18, 26, 16, ...days.map(() => 10)],
        heights: [],
        formats: {},
      },
    } satisfies CudyrSourceSheet,
  };
};
