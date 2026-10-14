import type { CudyrSourceSheet } from './cudyrSourceTypes';
import { parseCudyrSupplementMatrix } from './cudyrSupplementParser';

/** Parser joins Jasper page continuations; patient episodes are never deduplicated. */
export const prepareCudyrSourceTable = (source: CudyrSourceSheet, excerpt: boolean) => {
  const parsed = parseCudyrSupplementMatrix(source.matrix);
  if (!parsed.ok || parsed.report.month !== source.month) {
    if (excerpt)
      throw new Error('No se pudo aislar el día 1 del informe original del mes siguiente.');
    // Unknown legacy layouts retain their complete original cells and formatting.
    return { source, patients: null, label: '' };
  }
  const { report } = parsed;
  const patients = report.patients.filter(
    p => !excerpt || p.days.some(d => d.sourceDay === 1 && d.originalValue)
  );
  const days = report.patients[0].days.filter(d => !excerpt || d.sourceDay === 1);
  const label = excerpt
    ? `Día incluido: 01-${source.month.slice(5)}-${source.month.slice(0, 4)}`
    : `Mes: ${source.month}`;
  return {
    patients,
    label,
    source: {
      ...source,
      matrix: {
        sheet: source.matrix.sheet,
        rows: [
          [
            'N°',
            'Nombre Paciente',
            'Ficha Clínica',
            'RUN o Nro. Ident.',
            'Diagnóstico de Ingreso',
            'Días Hosp.',
            'Servicio Clínico',
            'Condición Alta',
            ...days.map(d => `Día ${d.sourceDay}`),
          ],
          ...patients.map(p => [
            p.ordinal,
            p.patientName,
            p.clinicalRecord,
            p.document,
            p.diagnosis,
            p.hospitalDays,
            p.service,
            p.dischargeCondition,
            ...p.days.filter(d => !excerpt || d.sourceDay === 1).map(d => d.originalValue),
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
          (_, i) => `A${patients.length + 2 + i}:H${patients.length + 2 + i}`
        ),
        widths: [8, 32, 14, 18, 40, 10, 26, 16, ...days.map(() => 10)],
        heights: [],
        formats: {},
      },
    } satisfies CudyrSourceSheet,
  };
};
