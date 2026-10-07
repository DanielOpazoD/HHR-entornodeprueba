import { describe, expect, it } from 'vitest';
import { parseCudyrSupplementMatrix } from '@/services/cudyr/cudyrSupplementParser';

const header = () => [
  'N°',
  'Nombre Paciente',
  'Ficha Clínica',
  'RUN o Nro. Ident.',
  '',
  'Diagnóstico de Ingreso',
  '',
  'Días Hosp.',
  'Servicio Clínico',
  '',
  'Condición Alta',
  ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
];
const patient = (ordinal = 1) => [
  ordinal,
  'Paciente Sintético',
  'Ficha de prueba',
  'ID-SINTETICO',
  '',
  'Diagnóstico sintético',
  '',
  3,
  'Área Médico Quirúrgica Indiferenciada',
  '',
  'Vivo',
  'C2',
  '',
  'S/C',
];
const matrix = () => ({
  sheet: 'Categorizacion_Riesgo_Dependenc',
  rows: [
    ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 07-10-2026 02:35'],
    ['Hospital Hanga Roa (Isla De Pascua)', 'Categorización Riesgo Dependencia'],
    ['Mes consultado: Octubre de 2026'],
    header(),
    patient(),
  ] as unknown[][],
});

describe('monthly CUDYR documentary evidence parser', () => {
  it('retains source dates, blanks and explicit S/C without inventing clinical applications', () => {
    const result = parseCudyrSupplementMatrix(matrix());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.month).toBe('2026-10');
    expect(result.report.patients[0].days.slice(0, 3)).toMatchObject([
      { sourceDate: '2026-10-01', category: 'C2', state: 'category' },
      { sourceDate: '2026-10-02', category: null, state: 'blank' },
      { sourceDate: '2026-10-03', category: null, state: 'uncategorized' },
    ]);
    expect(result.report.patients[0]).not.toHaveProperty('clinicalEpisodeId');
    expect(result.report.patients[0].days[0]).not.toHaveProperty('recordedAt');
    expect(result.report.generatedLabel).toBe('Fecha Hora Impresión: 07-10-2026 02:35');
  });
  it('reads noncontiguous day columns and repeated headers without extra patients', () => {
    const input = matrix();
    input.rows[3].splice(23, 0, '', '');
    input.rows[4][25] = 'B1';
    input.rows.push([...input.rows[3]], patient(2));
    const result = parseCudyrSupplementMatrix(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.patients).toHaveLength(2);
    expect(result.report.patients[0].days[12]).toMatchObject({ sourceColumn: 26, category: 'B1' });
  });
  it('accepts full repeated page headings even in the ordinal column', () => {
    const input = matrix();
    input.rows.push(...matrix().rows.slice(0, 4), patient(2));
    const result = parseCudyrSupplementMatrix(input);
    expect(result.ok && result.report.patients).toHaveLength(2);
  });
  it('does not interpret clinical content as document identity', () => {
    const input = matrix();
    input.rows[4][5] = 'Hospital Distinto';
    input.rows[4][8] = 'Mes consultado: Enero de 2027';
    expect(parseCudyrSupplementMatrix(input).ok).toBe(true);
    input.rows[1][0] = '';
    input.rows[4][5] = 'Hospital Hanga Roa (Isla De Pascua)';
    expect(parseCudyrSupplementMatrix(input).ok).toBe(false);
  });
  it.each(['Otro Hospital', 'Hospital Distinto'])('rejects foreign establishment %s', hospital => {
    const input = matrix();
    input.rows[1][0] = hospital;
    expect(parseCudyrSupplementMatrix(input).ok).toBe(false);
  });
  it('does not silently import a partial file after an unknown category', () => {
    const input = matrix();
    input.rows.push(patient(2));
    input.rows[5][11] = 'Z9';
    expect(parseCudyrSupplementMatrix(input)).toMatchObject({
      ok: false,
      issues: [{ row: 6, column: 12, code: 'value' }],
    });
  });
  it.each(['Mes consultado: Enero de 2027', 'Mes consultado: Octubre de 2025'])(
    'rejects mixed periods %s',
    period => {
      const input = matrix();
      input.rows.push([period]);
      expect(parseCudyrSupplementMatrix(input).ok).toBe(false);
    }
  );
  it('keeps separate source rows for a repeated person without claiming they are one episode', () => {
    const input = matrix();
    input.rows.push(patient(2));
    const result = parseCudyrSupplementMatrix(input);
    expect(result.ok && result.report.patients).toHaveLength(2);
  });
  it.each([
    'duplicate ordinal',
    'missing day',
    'duplicate day',
    'missing identity header',
    'unexpected row',
  ])('rejects ambiguous structure: %s', kind => {
    const input = matrix();
    if (kind === 'duplicate ordinal') input.rows.push(patient());
    if (kind === 'missing day') input.rows[3][11] = '';
    if (kind === 'duplicate day') input.rows[3][12] = 'Día 1';
    if (kind === 'missing identity header') input.rows[3][3] = '';
    if (kind === 'unexpected row') input.rows.push(['fila no reconocida']);
    expect(parseCudyrSupplementMatrix(input).ok).toBe(false);
  });
  it('permits empty printed days outside February but rejects an impossible dated value', () => {
    const input = matrix();
    input.rows[2][0] = 'Mes consultado: Febrero de 2026';
    const result = parseCudyrSupplementMatrix(input);
    expect(result.ok && result.report.patients[0].days).toHaveLength(28);
    input.rows[4][39] = 'C2';
    expect(parseCudyrSupplementMatrix(input).ok).toBe(false);
  });
  it('bounds malformed and oversized inputs before normalization', () => {
    expect(parseCudyrSupplementMatrix({ sheet: 'S', rows: new Array(5001).fill([]) }).ok).toBe(
      false
    );
    const input = matrix();
    input.rows[4][1] = { formula: 'not allowed' };
    expect(parseCudyrSupplementMatrix(input).ok).toBe(false);
  });
});
