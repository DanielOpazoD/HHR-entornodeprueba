import { describe, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { parseCudyrSupplementBinary } from '@/services/cudyr/cudyrSupplementBinary';
import { buildCudyrReportWorkbook } from '@/services/cudyr/cudyrReportWorkbook';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from './reportFixtures';
import { supplementCandidates } from '@/services/cudyr/cudyrSupplementPresentation';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
vi.mock('@/services/exporters/excelUtils', async () => {
  const { Workbook } = await import('exceljs');
  return { createWorkbook: async () => new Workbook(), BORDER_THIN: {} };
});
const book = () => {
  const b = utils.book_new();
  utils.book_append_sheet(
    b,
    utils.aoa_to_sheet([
      ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 07-10-2026 02:35'],
      ['Hospital Hanga Roa (Isla De Pascua)', 'Categorización Riesgo Dependencia'],
      ['Mes consultado: Octubre de 2026'],
      [
        'N°',
        'Nombre Paciente',
        'Ficha Clínica',
        'RUN o Nro. Ident.',
        'Diagnóstico de Ingreso',
        'Días Hosp.',
        'Servicio Clínico',
        'Condición Alta',
        ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
      ],
      [
        1,
        'Paciente Sintético',
        'FICHA-TEST',
        '11.111.111-1',
        '=texto literal',
        3,
        'MQ',
        'Vivo',
        'C2',
        '',
        'S/C',
      ],
    ]),
    'Synthetic'
  );
  return b;
};
const archive = (): ArchivedCudyrSupplement => {
  const parsed = parseCudyrSupplementBinary(write(book(), { type: 'array', bookType: 'biff8' }));
  if (!parsed.ok) throw new Error('Invalid synthetic workbook');
  return {
    id: 'version-test',
    contentId: 'content-test',
    month: '2026-10',
    report: parsed.report,
    importedAt: '2026-10-07T10:00:00Z',
    importedBy: {
      uid: 'test',
      name: 'Importador sintético',
      email: 'test@example.com',
      role: 'admin',
    },
    verification: 'user_imported',
    file: { name: 'synthetic.xls', sha256: 'synthetic-hash', byteLength: 1000 },
  };
};
describe('monthly binary reader and passive export', () => {
  it.each(['biff8', 'xlsx'] as const)(
    'reads real %s bytes with source cells and no fabricated hour',
    bookType => {
      const result = parseCudyrSupplementBinary(write(book(), { type: 'array', bookType }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.report.patients[0].days.slice(0, 3)).toMatchObject([
        { category: 'C2' },
        { state: 'blank' },
        { state: 'uncategorized' },
      ]);
      expect(result.report.patients[0]).not.toHaveProperty('recordedAt');
    }
  );
  it('rejects formulas and multiple data sheets instead of picking silently', () => {
    const b = book();
    b.Sheets.Synthetic.E5 = { t: 'n', f: '1+1', v: 2 };
    expect(() => parseCudyrSupplementBinary(write(b, { type: 'array', bookType: 'xlsx' }))).toThrow(
      /fórmulas/
    );
    const second = book();
    utils.book_append_sheet(second, utils.aoa_to_sheet([['unexpected']]), 'Other');
    expect(() =>
      parseCudyrSupplementBinary(write(second, { type: 'array', bookType: 'xlsx' }))
    ).toThrow(/sola hoja/);
  });
  it('matches documents only as candidates, leaves unknown identity unlinked and keeps versions', () => {
    const a = archive();
    expect(supplementCandidates([a], '11111111-1')).toHaveLength(1);
    expect(supplementCandidates([a], '')).toHaveLength(0);
    expect(supplementCandidates([a], 'SIN RUT')).toHaveLength(0);
    expect(supplementCandidates([a, { ...a, id: 'second-version' }], '11111111-1')).toHaveLength(2);
  });
  it.each(['statistics', 'audit'] as const)(
    'adds passive worksheets to %s without changing originals or the dataset',
    async mode => {
      const data = buildCudyrReport(reportInput());
      const before = structuredClone(data);
      const original = await buildCudyrReportWorkbook(data, undefined, mode);
      const added = await buildCudyrReportWorkbook(data, [archive()], mode);
      for (const sheet of original.workbook.worksheets)
        expect(added.workbook.getWorksheet(sheet.name)?.model).toEqual(sheet.model);
      expect(data).toEqual(before);
      const sheet = added.workbook.getWorksheet('Respaldo mensual Eloísa')!;
      expect(sheet.getCell('E2').value).toBe('=texto literal');
      if (mode === 'audit') {
        expect(sheet.getCell('Q2').value).toBe('Importador sintético');
        expect(sheet.getCell('V2').value).toContain('No suma');
      } else {
        expect(sheet.columnCount).toBe(10);
        expect(sheet.getCell('A2').value).toBe('Respaldo 1');
        expect(sheet.getCell('J3').value).toBe('Celda vacía');
        expect(sheet.getCell('J4').value).toBe('S/C explícito');
        const files = added.workbook.getWorksheet('Archivos complementarios')!;
        expect(files.getCell('A2').value).toBe('Respaldo 1');
        expect(files.getCell('E2').value).toBe('Importador sintético');
        expect(files.getCell('G2').value).toContain('No suma');
      }
    }
  );
});
