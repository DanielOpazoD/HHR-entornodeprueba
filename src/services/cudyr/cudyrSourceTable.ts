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
    if (episodes.size === 1 && !episodes.has('')) {
      for (const day of days) {
        const matches = own.filter(r => r.monthlyEvidence?.sourceDate === day.sourceDate);
        if (
          matches.length &&
          matches.every(
            r => r.eligibility === 'no_elegible' && r.monthlyEvidence?.state !== 'conflict'
          )
        )
          excluded.add(day.sourceDate);
      }
    }
    excludedDates.set(p.sourceRow, excluded);
    const relevant = days.filter(
      d => d.originalValue || own.some(r => r.monthlyEvidence?.sourceDate === d.sourceDate)
    );
    return !relevant.length || !relevant.every(d => excluded.has(d.sourceDate));
  });
  const days = report.patients[0].days.filter(d => !excerpt || d.sourceDay === 1);
  const monthName = new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${source.month}-01T00:00:00Z`)
  );
  const label = excerpt
    ? `Día incluido: 01-${source.month.slice(5)}-${source.month.slice(0, 4)}`
    : `${monthName[0].toUpperCase()}${monthName.slice(1)} ${source.month.slice(0, 4)}`;
  return {
    patients,
    allPatients: report.patients,
    label,
    excludedDates,
    source: {
      ...source,
      matrix: {
        sheet: source.matrix.sheet,
        rows: [
          [
            'N°',
            'Nombre Paciente',
            'RUN o Nro. Ident.',
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
            p.diagnosis,
            'No informado',
            p.service,
            p.dischargeCondition,
            ...p.days
              .filter(d => !excerpt || d.sourceDay === 1)
              .map(d => (excludedDates.get(p.sourceRow)?.has(d.sourceDate) ? '' : d.originalValue)),
          ]),
          [label],
          [
            '▼ Ingreso · ▲ Egreso — fechas calendario de HHR (Rapa Nui). Sin símbolo: movimiento no confirmado o no vinculado.',
          ],
          [report.establishment],
          [report.generatedLabel],
        ],
        merges: Array.from(
          { length: 4 },
          (_, i) => `A${patients.length + 2 + i}:G${patients.length + 2 + i}`
        ),
        widths: [8, 32, 18, 40, 18, 26, 16, ...days.map(() => 10)],
        heights: [],
        formats: {},
      },
    } satisfies CudyrSourceSheet,
  };
};
