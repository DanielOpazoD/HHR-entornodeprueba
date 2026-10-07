import type {
  CudyrSupplementDay,
  CudyrSupplementMatrix,
  CudyrSupplementParseIssue,
  CudyrSupplementParseResult,
  CudyrSupplementPatient,
} from '@/types/domain/cudyrSupplement';

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const months = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const columns = [
  'N°',
  'Nombre Paciente',
  'Ficha Clínica',
  'RUN o Nro. Ident.',
  'Diagnóstico de Ingreso',
  'Días Hosp.',
  'Servicio Clínico',
  'Condición Alta',
];
const clean = (value: unknown) =>
  value == null
    ? ''
    : typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
      ? String(value).trim()
      : null;

/** Strictly normalize the observed Jasper layout. Never assign episode, author, hour or census day. */
export const parseCudyrSupplementMatrix = ({
  sheet,
  rows,
}: CudyrSupplementMatrix): CudyrSupplementParseResult => {
  const issues: CudyrSupplementParseIssue[] = [];
  const issue = (
    row: number,
    column: number,
    code: CudyrSupplementParseIssue['code'],
    message: string
  ) => {
    if (issues.length < 100) issues.push({ row, column, code, message });
  };
  if (
    !sheet ||
    sheet.length > 100 ||
    rows.length > 5000 ||
    !rows.length ||
    rows.some(row => !Array.isArray(row) || row.length > 100)
  )
    return {
      ok: false,
      issues: [
        {
          row: 0,
          column: 0,
          code: 'limit',
          message: 'El informe supera los límites o no tiene una hoja válida.',
        },
      ],
    };
  const values = rows.map((row, r) =>
    row.map((value, c) => {
      const text = clean(value);
      if (text === null || text.length > 3000)
        issue(r + 1, c + 1, 'value', 'Valor de celda no admitido.');
      return text || '';
    })
  );
  const isMetadataRow = (row: string[]) =>
    row.some(Boolean) &&
    row
      .filter(Boolean)
      .every(value =>
        /^(?:ministerio de salud$|hospital\s|pagina\b|fecha hora impresion:|mes consultado:|categorizacion riesgo dependencia$)/.test(
          fold(value)
        )
      );
  const firstHeader = values.findIndex(row => row.map(fold).includes(fold('Nombre Paciente')));
  // Identity belongs to headings, never to arbitrary clinical cells.
  const all = values.filter((row, index) => index < firstHeader || isMetadataRow(row)).flat();
  const periods = all.filter(value => fold(value).startsWith('mes consultado:'));
  const periodValues = new Set(periods.map(fold));
  const period = periods[0] && fold(periods[0]).match(/^mes consultado:\s*([a-z]+) de (\d{4})$/);
  const monthIndex = period ? months.indexOf(period[1]) : -1;
  const year = period ? Number(period[2]) : 0;
  if (periodValues.size !== 1 || monthIndex < 0 || year < 2000 || year > 2100)
    issue(0, 0, 'period', 'No se pudo identificar un único mes consultado.');
  const establishments = all.filter(value => /^hospital\s/i.test(value));
  const establishment = establishments[0] || '';
  if (
    !establishments.length ||
    establishments.some(value => fold(value) !== 'hospital hanga roa (isla de pascua)')
  )
    issue(0, 0, 'structure', 'El establecimiento no corresponde al formato Hospital Hanga Roa.');
  const labels = [...new Set(all.filter(value => fold(value).startsWith('fecha hora impresion:')))];
  if (labels.length > 1)
    issue(0, 0, 'structure', 'El archivo contiene fechas de impresión diferentes.');
  if (!all.some(value => fold(value) === 'categorizacion riesgo dependencia'))
    issue(0, 0, 'structure', 'No se reconoce el informe de categorización.');
  if (issues.length) return { ok: false, issues };
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  let header: number[] | null = null;
  let dayColumns: Array<{ day: number; index: number }> = [];
  const patients: CudyrSupplementPatient[] = [];
  const ordinals = new Set<number>();
  for (let r = 0; r < values.length; r += 1) {
    const row = values[r];
    const folded = row.map(fold);
    if (folded.includes(fold('Nombre Paciente'))) {
      header = columns.map(label => folded.indexOf(fold(label)));
      dayColumns = folded.flatMap((value, index) => {
        const match = value.match(/^dia (\d+)$/);
        return match ? [{ day: Number(match[1]), index }] : [];
      });
      if (
        header.some(index => index < 0) ||
        columns.some(label => folded.filter(value => value === fold(label)).length !== 1) ||
        new Set(dayColumns.map(item => item.day)).size !== dayColumns.length ||
        dayColumns.some(item => item.day < 1 || item.day > 31) ||
        Array.from({ length: daysInMonth }, (_, i) => i + 1).some(
          day => !dayColumns.some(item => item.day === day)
        )
      )
        issue(r + 1, 0, 'structure', 'Encabezado incompleto o días repetidos.');
      continue;
    }
    if (!header || !row.some(Boolean)) continue;
    const ordinalText = row[header[0]] || '';
    if (isMetadataRow(row)) continue;
    const ordinal = Number(ordinalText);
    if (
      !/^\d+$/.test(ordinalText) ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 1 ||
      ordinals.has(ordinal)
    ) {
      issue(r + 1, header[0] + 1, 'structure', 'Fila sin número válido o repetida.');
      continue;
    }
    ordinals.add(ordinal);
    const fields = header.map(index => row[index] || '');
    if (!fields[1]) issue(r + 1, header[1] + 1, 'value', 'Paciente sin nombre informado.');
    const days: CudyrSupplementDay[] = [];
    for (const { day, index } of dayColumns) {
      const originalValue = row[index] || '';
      if (day > daysInMonth) {
        if (originalValue)
          issue(r + 1, index + 1, 'period', 'Categoría en un día inexistente del mes.');
        continue;
      }
      const category = /^[A-D][1-3]$/i.test(originalValue) ? originalValue.toUpperCase() : null;
      const uncategorized = /^s\s*\/\s*c$/i.test(originalValue);
      if (originalValue && !category && !uncategorized)
        issue(r + 1, index + 1, 'value', 'Categoría no reconocida.');
      days.push({
        sourceDay: day,
        sourceColumn: index + 1,
        sourceDate: `${month}-${String(day).padStart(2, '0')}`,
        originalValue,
        category,
        state: category ? 'category' : uncategorized ? 'uncategorized' : 'blank',
      });
    }
    patients.push({
      sourceRow: r + 1,
      ordinal,
      patientName: fields[1],
      clinicalRecord: fields[2],
      document: fields[3],
      diagnosis: fields[4],
      hospitalDays: fields[5],
      service: fields[6],
      dischargeCondition: fields[7],
      days: days.sort((a, b) => a.sourceDay - b.sourceDay),
    });
  }
  if (!header || !patients.length)
    issue(0, 0, 'structure', 'No se encontraron filas de pacientes reconocibles.');
  return issues.length
    ? { ok: false, issues }
    : {
        ok: true,
        report: {
          schemaVersion: 1,
          source: 'eloisa_monthly_report',
          month,
          establishment,
          generatedLabel: labels[0] || '',
          sheet,
          patients,
        },
      };
};
