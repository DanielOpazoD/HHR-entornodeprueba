import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from 'exceljs';
import { utils, write } from 'xlsx';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrEssentialWorkbook } from '@/services/cudyr/cudyrEssentialWorkbook';
import { readCudyrWorkbookMatrix } from '@/services/cudyr/cudyrSupplementBinary';
import {
  loadCudyrSourceSheets,
  selectCudyrSourceReports,
  addCudyrSourceSheets,
} from '@/services/cudyr/cudyrSourceWorkbook';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import { confirmedReportInput } from './reportFixtures';
const mocks = vi.hoisted(() => ({ load: vi.fn(), call: vi.fn(), generation: 1 }));
vi.mock('@/services/cudyr/cudyrSupplementService', () => ({
  loadCudyrSupplements: mocks.load,
  callCudyrArchive: mocks.call,
}));
vi.mock('@/services/storage/sessionStorageTransition', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/sessionStorageTransition')>()),
  getSessionGeneration: () => mocks.generation,
}));
const archive = (id = 'first', month = '2026-10'): ArchivedCudyrSupplement => ({
  id,
  contentId: id,
  month,
  report: supplementRequest().report,
  bytesVerified: true,
  importedAt: '2026-10-07T10:00:00Z',
  importedBy: { uid: 'synthetic', name: 'Sintético', email: '', role: 'admin' },
  verification: 'user_imported',
  file: { name: 'synthetic.xls', sha256: id, byteLength: 1000 },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 1;
});
describe('original Eloísa source in monthly Excel', () => {
  it('retains the original heights of blank spacer rows after binary export', async () => {
    const workbook = new Workbook();
    addCudyrSourceSheets(
      workbook,
      [
        {
          month: '2026-08',
          file: archive().file,
          matrix: {
            sheet: 'Original',
            rows: [['Título'], [], ['Datos']],
            merges: [],
            widths: [12],
            heights: [24, 42, 20, 35],
            formats: {},
          },
        },
      ],
      '2026-08'
    );
    const reopened = new Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(reopened.worksheets[0].getRow(2).height).toBe(42);
    expect(reopened.worksheets[0].getRow(4).height).toBe(35);
  });
  it('widens narrow source columns and merged patient fields without changing values', async () => {
    const workbook = new Workbook();
    const rows = [
      ['MINISTERIO DE SALUD', '', '', '', ''],
      ['N°', 'Nombre Paciente', '', 'RUN o Nro. Ident.', 'Día 31'],
      [104, 'Paciente Sintético Apellido Largo', '', 'ID-SINTETICO-001', 'C2'],
    ];
    const before = structuredClone(rows);
    addCudyrSourceSheets(
      workbook,
      [
        {
          month: '2026-08',
          file: archive().file,
          matrix: {
            sheet: 'Original',
            rows,
            merges: ['A1:E1', 'B2:C2', 'B3:C3'],
            widths: [2, 5, 2, 4, 2],
            heights: [18, 18, 18],
            formats: {},
          },
        },
      ],
      '2026-08'
    );
    const reopened = new Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = reopened.worksheets[0];
    expect(rows).toEqual(before);
    expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(8);
    expect(sheet.getColumn(1).width).toBeLessThanOrEqual(8);
    expect(sheet.getColumn(4).width).toBeGreaterThanOrEqual('ID-SINTETICO-001'.length + 2);
    expect(sheet.getColumn(5).width).toBeGreaterThanOrEqual(8);
    expect(sheet.getColumn(2).width! + sheet.getColumn(3).width!).toBeGreaterThanOrEqual(34);
    expect(sheet.getCell('E3').value).toBe('C2');
    expect(sheet.getCell('B3').value).toBe(rows[2][1]);
    expect(sheet.getRow(3).height).toBeLessThan(40);
    expect(sheet.getCell('C3').isMerged).toBe(true);
  });

  it.each([
    ['2026-08', '2026-09', 'Septiembre de 2026'],
    ['2026-12', '2027-01', 'Enero de 2027'],
  ])(
    'includes only next-month day 1 for %s, retaining S/C and excluding later-only patients',
    async (exportMonth, sourceMonth, label) => {
      const rows: unknown[][] = [
        ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 07-10-2026 02:35'],
        ['Hospital Hanga Roa (Isla De Pascua)', 'Categorización Riesgo Dependencia'],
        [`Mes consultado: ${label}`],
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
        [1, 'Paciente Día Uno', 'FICHA-A', 'DOC-A', 'Diagnóstico A', '2', 'MQ', 'Vivo', 'C2', 'A1'],
        [
          2,
          'Paciente Solo Día Dos',
          'FICHA-B',
          'DOC-B',
          'Diagnóstico B',
          '1',
          'MQ',
          'Vivo',
          '',
          'B1',
        ],
        [
          3,
          'Paciente Sin Categorizar',
          'FICHA-C',
          'DOC-C',
          'Diagnóstico C',
          '1',
          'MQ',
          'Vivo',
          'S/C',
          'D3',
        ],
      ];
      const matrix = { sheet: 'Original', rows, merges: [], widths: [], heights: [], formats: {} };
      const before = structuredClone(matrix);
      const workbook = new Workbook();
      addCudyrSourceSheets(
        workbook,
        [{ month: sourceMonth, file: archive().file, matrix }],
        exportMonth
      );
      const reopened = new Workbook();
      await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
      const sheet = reopened.worksheets[0];
      expect(matrix).toEqual(before);
      expect(sheet.name).toBe(`Eloísa ${sourceMonth}`);
      expect(sheet.columnCount).toBe(9);
      expect(sheet.getCell('I1').value).toBe('Día 1');
      expect(sheet.getCell('A4').value).toBe(
        `Día incluido: 01-${sourceMonth.slice(5)}-${sourceMonth.slice(0, 4)}`
      );
      expect(sheet.getCell('I2').value).toBe('C2');
      expect(sheet.getCell('I3').value).toBe('S/C');
      expect(sheet.rowCount).toBe(7);
      expect(sheet.getCell('A1').note).toContain('Extracto: solo el día 1');
      expect(sheet.getCell('B3').value).toBe('Paciente Sin Categorizar');
    }
  );

  it('rejects an unreadable next-month source rather than exporting the entire month', () => {
    const source = {
      month: '2026-09',
      file: archive().file,
      matrix: {
        sheet: 'Unexpected',
        rows: [['Día 1', 'Día 2']],
        merges: [],
        widths: [],
        heights: [],
        formats: {},
      },
    };
    expect(() => addCudyrSourceSheets(new Workbook(), [source], '2026-08')).toThrow(
      /aislar el día 1/
    );
  });

  it.each([
    ['biff8', false],
    ['biff8', true],
    ['xlsx', false],
    ['xlsx', true],
  ] as const)(
    'roundtrips %s source cells (1904=%s) in the second sheet, preserving dates, merges and HHR totals',
    async (bookType, date1904) => {
      const source = utils.book_new();
      source.Workbook = { WBProps: { date1904 } };
      const matrix = [
        ['MINISTERIO DE SALUD', '', 'Día 3'],
        ['Paciente sintético', '0001-K', '=texto literal'],
        ['C2', '', 'S/C'],
        [46500, 0.25, 'Columna estrecha'],
        [0.25, 0.25, 0.25],
      ];
      const sheet = utils.aoa_to_sheet(matrix);
      sheet['!merges'] = [utils.decode_range('A1:B1')];
      sheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 2 }];
      sheet.A4.z = 'yyyy-mm-dd';
      sheet.B4.z = '0%';
      sheet.A5.z = '[h]:mm';
      sheet.B5.z = '[mm]';
      sheet.C5.z = 'h:mm';
      sheet['!rows'] = [{ hpt: 28 }];
      utils.book_append_sheet(source, sheet, 'Original');
      const data = buildCudyrReport(confirmedReportInput());
      const sourceMatrix = readCudyrWorkbookMatrix(
        write(source, { type: 'array', bookType }),
        true
      );
      expect(sourceMatrix.rows[4]).toEqual([0.25, 0.25, 0.25]);
      const { workbook: built } = await buildCudyrEssentialWorkbook(data, [
        {
          month: '2026-10',
          file: archive().file,
          matrix: sourceMatrix,
        },
      ]);
      const reopened = new Workbook();
      await reopened.xlsx.load(await built.xlsx.writeBuffer());
      const copied = reopened.worksheets[1];
      expect(copied.name).toBe('Eloísa 2026-10');
      expect(copied.getCell('C1').value).toBe('Día 3');
      expect(copied.getCell('B2').value).toBe('0001-K');
      expect(copied.getCell('C2').value).toBe('=texto literal');
      expect(copied.getCell('C2').formula).toBeUndefined();
      expect(copied.getCell('C3').value).toBe('S/C');
      expect(copied.getCell('B3').value).toBeNull();
      expect(copied.getCell('A4').value).toBeInstanceOf(Date);
      expect((copied.getCell('A4').value as Date).toISOString().slice(0, 10)).toBe(
        new Date((46500 + (date1904 ? 1462 : 0) - 25569) * 86400000).toISOString().slice(0, 10)
      );
      expect(copied.getCell('A4').numFmt).toBe('yyyy-mm-dd');
      expect(copied.getCell('B4').value).toBe(0.25);
      expect(copied.getCell('B4').numFmt).toBe('0%');
      expect(Number.isFinite(copied.getRow(4).height)).toBe(true);
      expect(copied.getCell('B1').isMerged).toBe(true);
      if (bookType === 'xlsx') expect(copied.getRow(1).height).toBe(28);
      else expect(copied.getRow(1).height).toBeGreaterThanOrEqual(18);
      expect(copied.getCell('A1').note).toContain('synthetic.xls');
      expect(reopened.getWorksheet('02-10-2026')!.getCell('B20').value).toBe(1);
      expect(reopened.worksheets[2].name).toBe('01-10-2026');
    }
  );
  it('includes every source version actually used, the following month for the last night, and deduplicates identical bytes', () => {
    const data = buildCudyrReport(confirmedReportInput());
    data.rows = [...data.rows, { ...data.rows[0], key: 'next' }];
    data.rows[0].monthlyEvidence = {
      reportId: 'old',
      sourceDate: '2026-10-03',
      checkedAt: '',
      state: 'found',
    };
    data.rows[1].monthlyEvidence = {
      reportId: 'next',
      sourceDate: '2026-11-01',
      checkedAt: '',
      state: 'found',
    };
    expect(
      selectCudyrSourceReports(data, [
        archive('new'),
        archive('old'),
        archive('next', '2026-11'),
      ]).map(r => r.id)
    ).toEqual(['old', 'next']);
    expect(() => selectCudyrSourceReports(data, [archive('new')])).toThrow(/Falta/);
    data.rows[1].monthlyEvidence!.reportId = 'copy';
    const copy = archive('copy');
    copy.file.sha256 = 'old';
    expect(selectCudyrSourceReports(data, [archive('old'), copy])).toHaveLength(1);
    delete data.rows[0].monthlyEvidence;
    delete data.rows[1].monthlyEvidence;
    expect(
      selectCudyrSourceReports(data, [
        archive('old'),
        { ...archive('new'), importedAt: '2026-10-08T10:00:00Z' },
        archive('next', '2026-11'),
      ]).map(r => r.id)
    ).toEqual(['new']);
  });
  it('reads archived bytes only on demand and discards an in-flight file when the session changes', async () => {
    const data = buildCudyrReport(confirmedReportInput());
    mocks.load.mockResolvedValue([archive()]);
    mocks.call.mockImplementation(async () => {
      mocks.generation++;
      return { ...archive().file, base64: supplementRequest().file.base64 };
    });
    await expect(loadCudyrSourceSheets(data, new AbortController().signal)).rejects.toThrow(
      /sesión/
    );
    expect(mocks.call).toHaveBeenCalledWith('readCudyrHistory', {
      kind: 'monthly-supplement-file',
      id: 'first',
    });
  });
  it('shows an explicit absent-source note instead of fabricating an Eloísa report', async () => {
    mocks.load.mockResolvedValue([]);
    const data = buildCudyrReport(confirmedReportInput());
    const sources = await loadCudyrSourceSheets(data, new AbortController().signal);
    const { workbook } = await buildCudyrEssentialWorkbook(data, sources);
    expect(workbook.worksheets[1].getCell('A1').value).toContain('no guardado');
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
