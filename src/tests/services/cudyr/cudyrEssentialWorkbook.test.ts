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
  it('exports historical origin while retaining the original author and statistical validity', async () => {
    const data = buildCudyrReport(confirmedReportInput({ records: [reportRecord()] }));
    data.rows[0].monthlyEvidence = {
      reportId: 'report',
      sourceDate: '2026-10-03',
      checkedAt: '2026-10-08T18:00:00Z',
      state: 'found',
    };
    const author = data.rows[0].evaluation!.author;
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.getWorksheet('Pacientes elegibles')!.getCell('K2').value).toBe(
      'Eloísa · Excel de categorización'
    );
    expect(workbook.getWorksheet('Pacientes elegibles')!.getCell('L2').value).toBe(author);
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
    expect(workbook.worksheets.map(s => s.name)).toEqual(['Resumen', 'Pacientes elegibles']);
    const detail = workbook.getWorksheet('Pacientes elegibles')!;
    expect(detail.rowCount).toBe(3);
    expect(detail.columnCount).toBe(17);
    expect(detail.getRow(2).getCell(2).value).toBe('Segundo sintético');
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
    expect(workbook.getWorksheet('Pacientes elegibles')!.getCell('G2').value).toBe('');
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
  expect(workbook.getWorksheet('Resumen')!.getCell('G2').value).toBe(
    'Oficial · censo reconstruido aprobado'
  );
});
