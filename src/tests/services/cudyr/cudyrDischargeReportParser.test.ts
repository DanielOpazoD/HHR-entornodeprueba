import { describe, expect, it } from 'vitest';
import { parseCudyrDischargeReport } from '@/services/cudyr/cudyrDischargeReportParser';
import { readCudyrWorkbookMatrix } from '@/services/cudyr/cudyrSupplementBinary';
import { utils, write } from 'xlsx';
const header = [
  'Servicio',
  'Cama',
  '',
  'Nombre Paciente',
  '',
  '',
  'N° Ident.',
  'Edad',
  'Estadía (d)',
  'Destino de Alta',
  'Motivo de Alta',
  'Fecha Egreso',
  '',
  'Diagnóstico Ingreso',
];
const row = [
  'MQ',
  'R1',
  '',
  'Paciente Sintético',
  '',
  '',
  'ID-TEST',
  '30',
  '2',
  '',
  '',
  '20-07-2026  13:45',
  '',
  'Diagnóstico sintético',
];
const matrix = () => ({
  sheet: 'Synthetic',
  rows: [
    ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 01-08-2026 12:00'],
    ['Lista de Pacientes con Alta Administrativa por Rango de Fecha'],
    ['Desde: 01-07-2026 Hasta: 31-07-2026'],
    header,
    row,
    header,
    row,
  ],
});
describe('administrative discharge documentary parser', () => {
  it('preserves repeated patient rows while excluding repeated headers and normalizing dates', () => {
    expect(parseCudyrDischargeReport(matrix())).toMatchObject({
      from: '2026-07-01',
      to: '2026-07-31',
      rows: [
        { sourceRow: 5, date: '2026-07-20', time: '13:45', bed: 'R1' },
        { sourceRow: 7, date: '2026-07-20', time: '13:45' },
      ],
    });
  });
  it.each(['31-02-2026 12:00', '20-07-2026 25:00', '01-08-2026 12:00', '20-07-2026'])(
    'rejects invalid, out-of-period and incomplete dates: %s',
    at => {
      const m = matrix();
      m.rows[4] = [...row];
      m.rows[4][11] = at;
      expect(() => parseCudyrDischargeReport(m)).toThrow();
    }
  );
  it('rejects unknown rows rather than silently claiming complete coverage', () => {
    const m = matrix();
    m.rows.push(['unknown footer']);
    expect(() => parseCudyrDischargeReport(m)).toThrow();
  });
  it('reads a real BIFF container through the shared size/formula boundary', () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(matrix().rows), 'Synthetic');
    expect(
      parseCudyrDischargeReport(
        readCudyrWorkbookMatrix(write(book, { type: 'array', bookType: 'biff8' }))
      )
    ).toHaveProperty('rows.length', 2);
    book.Sheets.Synthetic.A5 = { t: 'n', v: 1, f: '1+1' };
    expect(() => readCudyrWorkbookMatrix(write(book, { type: 'array', bookType: 'xlsx' }))).toThrow(
      /fórmulas/
    );
  });
});
