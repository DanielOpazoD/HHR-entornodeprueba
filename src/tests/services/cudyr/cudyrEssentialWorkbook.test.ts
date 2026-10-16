import { validateCudyrWorkbookTotals } from '@/services/cudyr/cudyrWorkbookValidation';
import { confirmedReportInput } from './reportFixtures';
import { describe, expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrEssentialWorkbook } from '@/services/cudyr/cudyrEssentialWorkbook';
import { reportInput, reportPatient, reportRecord } from './reportFixtures';
import type { CudyrDailyExclusion } from '@/types/domain/cudyrExclusion';
const exclusion: CudyrDailyExclusion = {
  id: 'decision',
  date: '2026-10-02',
  clinicalEpisodeId: 'synthetic-episode',
  revision: 1,
  operationId: 'operation',
  reason: 'not_hospitalized',
  note: 'Salida física verificada, pendiente regularización.',
  source: 'manual',
  updatedAt: '2026-10-03T10:00:00Z',
  updatedBy: { uid: 'user', name: 'Revisor', email: '', role: 'admin' },
};
describe('essential CUDYR export and daily exclusions', () => {
  it('retains the original author and statistical validity without an origin column', async () => {
    const data = buildCudyrReport(confirmedReportInput({ records: [reportRecord()] }));
    data.rows[0].monthlyEvidence = {
      reportId: 'report',
      sourceDate: '2026-10-03',
      checkedAt: '2026-10-08T18:00:00Z',
      state: 'found',
    };
    const author = data.rows[0].evaluation!.author;
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.getWorksheet('02-10-2026')!.columnCount).toBe(10);
    expect(workbook.getWorksheet('02-10-2026')!.getCell('G25').value).toContain(author);
    expect(cudyrReportTotals(data.rows).categorized).toBe(1);
  });
  it('limits a manual exclusion to its episode and day, retaining results for review', async () => {
    const data = buildCudyrReport(
      confirmedReportInput({
        exclusions: [exclusion],
        records: [
          reportRecord(),
          reportRecord('2026-10-03'),
          reportRecord('2026-10-02', {
            NEO1: reportPatient({
              bedId: 'NEO1',
              clinicalEpisodeId: 'second',
              patientName: 'Segundo sintético',
            }),
          }),
        ],
      })
    );
    const excluded = data.rows.find(
      row => row.date === exclusion.date && row.clinicalEpisodeId === exclusion.clinicalEpisodeId
    )!;
    expect(excluded.eligibility).toBe('no_elegible');
    expect(excluded.evaluation).not.toBeNull();
    expect(cudyrReportTotals(data.rows)).toMatchObject({
      eligible: 2,
      excluded: 1,
      categorized: 2,
    });
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.worksheets.map(s => s.name)).toEqual([
      'Resumen CUDYR Mensual',
      '01-10-2026',
      '02-10-2026',
      '03-10-2026',
      '04-10-2026',
    ]);
    const detail = workbook.getWorksheet('02-10-2026')!;
    expect(detail.rowCount).toBe(26);
    expect(detail.columnCount).toBe(10);
    expect(detail.getCell('C25').value).toBe('Segundo sintético');
    expect(detail.getCell('I26').value).toBe('No elegible');
    expect(detail.getCell('H26').value).toBe('Registrado');
    expect(detail.getCell('B19').value).toBe(1);
    expect(detail.getCell('B20').value).toBe(1);
    expect(data.rows).toHaveLength(3);
  });
  it('withdraws manual decisions by recalculating automatic eligibility, never forcing eligibility', () => {
    const data = buildCudyrReport(
      reportInput({
        exclusions: [{ ...exclusion, reason: null }],
        records: [reportRecord('2026-10-02', { R1: reportPatient({ bedMode: 'Cuna' }) })],
      })
    );
    expect(data.rows[0].eligibility).toBe('no_elegible');
    expect(data.rows[0].eligibilityReason).toContain('Cuna');
  });
  it('refuses an incomplete read and leaves missing scores blank', async () => {
    const data = buildCudyrReport(confirmedReportInput({ records: [reportRecord()] }));
    data.rows[0].evaluation!.dependencyScore = null;
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.getWorksheet('02-10-2026')!.getCell('E25').value).toBe(
      data.rows[0].evaluation!.category
    );
    await expect(
      buildCudyrEssentialWorkbook({ ...data, issues: ['Exclusions unavailable'] })
    ).rejects.toThrow('lectura');
  });
});

it('exports approved reconstructed days as official without requiring the historical reports to match', async () => {
  const data = buildCudyrReport(confirmedReportInput({ records: [reportRecord()] }));
  data.rows[0].monthlyEvidence = {
    reportId: 'source',
    sourceDate: '2026-10-03',
    checkedAt: '2026-10-08T20:00:00Z',
    state: 'found',
  };
  data.coverage.forEach(day => {
    day.censusVerification = {
      state: 'mismatch',
      missing: 1,
      extra: 0,
      reason: 'Informe histórico incompleto',
    };
    day.reconstructionApproval = {
      approvedAt: '2026-10-08T20:00:00Z',
      approvedBy: 'Responsable',
      reason: 'Reconstrucción aprobada',
    };
  });
  const { workbook } = await buildCudyrEssentialWorkbook(data);
  expect(workbook.getWorksheet('02-10-2026')!.getCell('A2').value).toBe('Oficial');
});

describe('export arithmetic and operational safeguards', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  it.each([
    ['Resumen CUDYR Mensual', 'B20'],
    ['Resumen CUDYR Mensual', 'B21'],
    ['Resumen CUDYR Mensual', 'B22'],
    ['02-10-2026', 'B19'],
    ['02-10-2026', 'B20'],
    ['02-10-2026', 'D4'],
    ['02-10-2026', 'B16'],
    ['02-10-2026', 'C16'],
    ['02-10-2026', 'D16'],
  ])('blocks a corrupted total in %s %s', async (name, address) => {
    const data = buildCudyrReport(confirmedReportInput());
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    workbook.getWorksheet(name)!.getCell(address).value = 999;
    expect(() => validateCudyrWorkbookTotals(workbook, data, dates)).toThrow('no coinciden');
  });
  it('keeps a sick newborn in its own hospital classification and excludes a healthy crib', async () => {
    const data = buildCudyrReport(
      confirmedReportInput({
        records: [
          reportRecord('2026-10-02', {
            R1: reportPatient({
              bedMode: 'Cuna',
              clinicalEpisodeId: 'healthy-rn',
              patientName: 'RN sano sintético',
            }),
            NEO1: reportPatient({
              bedId: 'NEO1',
              clinicalEpisodeId: 'sick-rn',
              patientName: 'RN hospitalizado sintético',
            }),
          }),
        ],
      })
    );
    expect(cudyrReportTotals(data.rows)).toMatchObject({
      eligible: 1,
      categorized: 1,
      excluded: 1,
    });
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    const summary = workbook.getWorksheet('Resumen CUDYR Mensual')!;
    expect(summary.getCell('A24').text).toContain('1 / 1 pacientes-día elegibles = 100%');
    const sheet = workbook.getWorksheet('02-10-2026')!;
    expect(sheet.rowCount).toBe(26);
    expect(sheet.getCell('B19').value).toBe(1);
    expect(sheet.getCell('C25').text).toBe('RN hospitalizado sintético');
    expect(sheet.getCell('I26').text).toBe('No elegible');
  });
  it('keeps the application window outside totals and does not report zero percent without eligible days', async () => {
    const data = buildCudyrReport(confirmedReportInput({ generatedAt: '2026-10-03T08:00:00Z' }));
    expect(data.rows[0].applicationPending).toBe(true);
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    const summary = workbook.getWorksheet('Resumen CUDYR Mensual')!;
    expect(summary.getCell('B22').result).toBe('');
    expect(summary.getCell('A24').text).toContain('Sin pacientes-día elegibles');
    expect(workbook.getWorksheet('02-10-2026')!.getCell('B19').value).toBeNull();
  });
});
