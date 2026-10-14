import { describe, expect, it, vi } from 'vitest';
import { Workbook } from 'exceljs';
import { addCudyrSourceSheets, type CudyrSourceSheet } from '@/services/cudyr/cudyrSourceWorkbook';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';

vi.mock('@/services/cudyr/cudyrSupplementService', () => ({}));
const header = [
  'N°',
  'Nombre Paciente',
  'Ficha Clínica',
  'RUN o Nro. Ident.',
  'Diagnóstico de Ingreso',
  'Días Hosp.',
  'Servicio Clínico',
  'Condición Alta',
  ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
];
const source = (): CudyrSourceSheet => ({
  month: '2026-10',
  reportId: 'source',
  file: { name: 'synthetic.xls', sha256: 'synthetic', byteLength: 100 },
  matrix: {
    sheet: 'Original',
    merges: [],
    widths: [],
    heights: [],
    formats: {},
    rows: [
      ['Hospital Hanga Roa (Isla de Pascua)', 'Categorización Riesgo Dependencia'],
      ['Mes consultado: Octubre de 2026'],
      header,
      [1, 'Paciente Sintético', 'FICHA', 'DOC', 'Diagnóstico', '2', 'MQ', 'Vivo', 'C2', 'S/C'],
      ['Página 2'],
      header,
      ['', 'Apellido', '', '', 'continuado', '', 'continuado'],
      [2, 'Paciente Sintético', 'FICHA', 'DOC', 'Otro episodio', '1', 'MQ', 'Vivo', '', 'D3'],
    ],
  },
});
const row = (): CudyrReportRow => ({
  ...buildCudyrReport(confirmedReportInput()).rows[0],
  clinicalEpisodeId: 'episode',
  hospitalAdmissionAt: '2026-10-01T06:47:00Z',
  admissionEvidenceConflict: false,
  monthlyEvidence: {
    reportId: 'source',
    sourceRow: 4,
    sourceDate: '2026-10-01',
    checkedAt: '',
    state: 'found',
  },
  movements: [
    {
      clinicalEpisodeId: 'episode',
      censusDate: '2026-10-01',
      id: 'exit',
      section: 'discharges',
      bedId: 'R1',
      bedName: 'R1',
      service: 'MQ',
      modality: 'hospitalizacion',
      date: '2026-10-02',
      time: '01:47',
      recordedAt: '2026-10-03T12:00:00Z',
      source: 'gestion_camas',
      lineageId: 'exit',
      medicalEpicrisisStatus: '',
      nursingEpicrisisStatus: '',
      epicrisisRegisteredAt: '2026-10-03T10:00:00Z',
    },
  ],
});
const exportSheet = async (rows: CudyrReportRow[] = [], current = source(), month = '2026-10') => {
  const before = JSON.stringify({ rows, current });
  const workbook = new Workbook();
  addCudyrSourceSheets(workbook, [current], month, rows);
  const reopened = new Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  expect(JSON.stringify({ rows, current })).toBe(before);
  return reopened.worksheets[0];
};

describe('readable source table and documentary movement annotations', () => {
  it('keeps one frozen header, joins page continuations and retains separate episodes of the same person', async () => {
    const sheet = await exportSheet();
    expect(sheet.getCell('B1').value).toBe('Nombre Paciente');
    expect(sheet.getCell('B2').value).toBe('Paciente Sintético Apellido');
    expect(sheet.getCell('E2').value).toBe('Diagnóstico continuado');
    expect(sheet.getCell('B3').value).toBe('Paciente Sintético');
    expect(sheet.getCell('E3').value).toBe('Otro episodio');
    expect(sheet.getCell('I2').value).toBe('C2');
    expect(sheet.getCell('J2').value).toBe('S/C');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 4, ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:AM3');
    expect(sheet.pageSetup.printTitlesRow).toBe('1:1');
    expect(sheet.getColumn(9).width).toBeGreaterThanOrEqual(10);
  });
  it('annotates real calendar dates in Rapa Nui, leaving categories and re-admissions intact', async () => {
    const sheet = await exportSheet([row()]);
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('I2').note).toContain('2026-10-01 01:47');
    expect(sheet.getCell('J2').text).toBe('▲ S/C');
    expect(sheet.getCell('J2').note).toContain('2026-10-02 01:47');
    expect(sheet.getCell('J2').note).not.toContain('2026-10-03');
    expect(sheet.getCell('J3').value).toBe('D3');
    expect(sheet.getCell('I2').value).toMatchObject({
      richText: [{ font: { color: { argb: 'FF047857' } } }, { text: 'C2' }],
    });
  });
  it('shows both symbols for a same-day stay, including a blank original category', async () => {
    const r = row();
    r.hospitalAdmissionAt = '2026-10-02T05:30:00Z';
    const s = source();
    s.matrix.rows[3][9] = '';
    const sheet = await exportSheet([r], s);
    expect(sheet.getCell('J2').text).toBe('▼ ▲ ');
    expect(sheet.getCell('J2').note).toContain('(vacío)');
  });
  it.each(['missing-link', 'wrong-source', 'conflicting-link', 'two-episodes', 'two-source-rows'])(
    'does not infer movements for %s',
    async reason => {
      const r = row();
      const rows = [r];
      if (reason === 'missing-link') delete r.monthlyEvidence;
      if (reason === 'wrong-source') r.monthlyEvidence!.reportId = 'other';
      if (reason === 'conflicting-link') r.monthlyEvidence!.state = 'conflict';
      if (reason === 'two-episodes') rows.push({ ...r, clinicalEpisodeId: 'other' });
      if (reason === 'two-source-rows')
        rows.push({ ...r, monthlyEvidence: { ...r.monthlyEvidence!, sourceRow: 8 } });
      const sheet = await exportSheet(rows);
      expect(sheet.getCell('I2').value).toBe('C2');
      expect(sheet.getCell('J2').value).toBe('S/C');
    }
  );
  it('omits inconsistent admission dates and ambiguous departures', async () => {
    const r = row();
    const other = {
      ...r,
      hospitalAdmissionAt: '2026-10-02T09:00:00Z',
      movements: [{ ...r.movements[0], date: '2026-10-03' }],
    };
    const sheet = await exportSheet([r, other]);
    expect(sheet.getCell('I2').value).toBe('C2');
    expect(sheet.getCell('J2').value).toBe('S/C');
  });
  it('does not use unproven discharge sources or admission conflicts', async () => {
    const r = row();
    r.admissionEvidenceConflict = true;
    r.movements[0].source = 'HHR · procedencia no documentada';
    const sheet = await exportSheet([r]);
    expect(sheet.getCell('I2').value).toBe('C2');
    expect(sheet.getCell('J2').value).toBe('S/C');
  });
  it('uses the latest verified discharge correction and does not invent a missing hour', async () => {
    const r = row();
    r.correction = {
      schemaVersion: 1,
      clinicalEpisodeId: 'episode',
      revision: 2,
      operationId: 'synthetic',
      actualDischarge: { date: '2026-10-03', timeZone: 'Pacific/Easter' },
      reason: 'Verified synthetic correction',
      authorityDate: '2026-10-03',
      admissionDate: '2026-10-01',
      sourceContexts: [],
      updatedAt: '2026-10-04T12:00:00Z',
      updatedBy: { uid: 'test', email: '', name: 'Test', role: 'admin' },
    };
    const old = {
      ...r,
      correction: {
        ...r.correction,
        revision: 1,
        actualDischarge: { date: '2026-10-02', timeZone: 'Pacific/Easter' as const },
      },
    };
    const sheet = await exportSheet([r, old]);
    expect(sheet.getCell('J2').value).toBe('S/C');
    expect(sheet.getCell('K2').text).toBe('▲ ');
    expect(sheet.getCell('K2').note).toContain('2026-10-03 · hora no informada');
  });
  it('keeps only day 1 in the following month, without leaking later movement markers', async () => {
    const sheet = await exportSheet([row()], source(), '2026-09');
    expect(sheet.columnCount).toBe(9);
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('I3').value).toBeNull();
    expect(sheet.autoFilter).toBe('A1:I2');
  });
});
