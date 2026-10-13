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
