import type { CudyrSupplementMatrix } from '@/types/domain/cudyrSupplement';
import { isCalendarDate } from '@/utils/clinicalDateUtils';
import type { CudyrDischargeReport } from '@/types/domain/cudyrReconciliation';

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const iso = (value: string) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) throw new Error('Fecha de alta no reconocida.');
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  if (!isCalendarDate(date)) throw new Error('Fecha inexistente en el informe de altas.');
  return date;
};
const labels = [
  'Servicio',
  'Cama',
  'Nombre Paciente',
  'N° Ident.',
  'Fecha Egreso',
  'Diagnóstico Ingreso',
];

/** Values from the observed administrative discharge layout. Bed is at discharge, never daily history. */
export const parseCudyrDischargeReport = (matrix: CudyrSupplementMatrix): CudyrDischargeReport => {
  if (
    !matrix.rows.length ||
    matrix.rows.length > 5000 ||
    matrix.rows.some(r => !Array.isArray(r) || r.length > 100)
  )
    throw new Error('Límites del informe de altas excedidos.');
  const rows = matrix.rows.map(r =>
    r.map(v => {
      if (v == null) return '';
      if ((typeof v !== 'string' && typeof v !== 'number') || String(v).length > 3000)
        throw new Error('Celda de altas no admitida.');
      return String(v).trim();
    })
  );
  const firstHeader = rows.findIndex(r => r.includes('Nombre Paciente'));
  const heading = rows.slice(0, firstHeader).flat();
  if (
    firstHeader < 0 ||
    !heading.some(v => fold(v) === 'lista de pacientes con alta administrativa por rango de fecha')
  )
    throw new Error('No se reconoce el informe de altas administrativas.');
  const periods = [...new Set(heading.filter(v => /^Desde:/.test(v)))];
  const period = periods[0]?.match(/^Desde:\s*(\d{2}-\d{2}-\d{4})\s+Hasta:\s*(\d{2}-\d{2}-\d{4})$/);
  const [, fromRaw, toRaw] = period ?? [];
  if (periods.length !== 1 || !fromRaw || !toRaw)
    throw new Error('Período de altas no verificable.');
  const from = iso(fromRaw),
    to = iso(toRaw);
  if (from > to) throw new Error('Período de altas invertido.');
  const generatedLabel = heading.find(v => fold(v).startsWith('fecha hora impresion:')) || '';
  const report: CudyrDischargeReport = { from, to, generatedLabel, rows: [] };
  let columns: number[] = [];
  rows.slice(firstHeader).forEach((row, offset) => {
    if (!row.some(Boolean)) return;
    if (row.includes('Nombre Paciente')) {
      columns = labels.map(label => row.indexOf(label));
      if (labels.some(label => row.filter(v => v === label).length !== 1))
        throw new Error('Encabezado de altas incompleto o repetido.');
      return;
    }
    if (!columns.length) throw new Error('Falta encabezado de altas.');
    const [service = '', bed = '', patientName = '', document = '', dateTime = '', diagnosis = ''] =
      columns.map(i => row[i] || '');
    const at = /^(\d{2}-\d{2}-\d{4})\s+((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(dateTime);
    const [, dateRaw, timeRaw] = at ?? [];
    if (!patientName || !dateRaw || !timeRaw)
      throw new Error(`Fila ${firstHeader + offset + 1}: alta sin nombre o fecha/hora válida.`);
    const date = iso(dateRaw);
    if (date < from || date > to) throw new Error('Alta fuera del período declarado.');
    report.rows.push({
      sourceRow: firstHeader + offset + 1,
      service,
      bed,
      patientName,
      document,
      date,
      time: timeRaw,
      diagnosis,
    });
  });
  if (!report.rows.length) throw new Error('El archivo no contiene altas reconocibles.');
  return report;
};
