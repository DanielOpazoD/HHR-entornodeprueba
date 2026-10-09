import { describe, expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { reportInput, reportPatient, reportRecord, reportObservation } from './reportFixtures';
describe('CUDYR admission evidence', () => {
  it('retains unconfirmed hospital rows for review without counting or exporting them', async () => {
    const data = buildCudyrReport(
      reportInput({
        records: [reportRecord('2026-10-02', { R1: reportPatient({ admissionTime: '' }) })],
      })
    );
    expect(data.rows[0].hospitalAdmissionAt).toBe('');
    expect(data.rows[0].eligibility).toBe('por_revisar');
    expect(cudyrReportTotals(data.rows)).toMatchObject({ eligible: 0, categorized: 0, review: 1 });
    const { buildCudyrEssentialWorkbook } = await import('@/services/cudyr/cudyrEssentialWorkbook');
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.getWorksheet('Pacientes elegibles')!.rowCount).toBe(1);
  });
  it('uses daily demographic admission when historical bed movements are missing', () => {
    const data = buildCudyrReport(
      reportInput({
        records: [
          reportRecord('2026-10-02', {
            R1: reportPatient({
              admissionDate: '2026-10-02',
              admissionTime: '22:23',
            }),
          }),
        ],
        observations: [reportObservation()],
      })
    );
    const row = data.rows[0];
    expect(row.hospitalAdmissionAt).toBe('2026-10-03T03:23:00.000Z');
    expect(row.hospitalAdmissionSource).toContain('Datos demográficos');
    expect(row.cudyrStatus).toBe('registrado');
    expect(row.eligibility).toBe('no_elegible');
    expect(row.eligibilityReason).toContain('menor de 8 horas');
    expect(cudyrReportTotals(data.rows)).toMatchObject({
      eligible: 0,
      categorized: 0,
      excluded: 1,
    });
  });
  it('counts an eligible daily admission without requiring a second download from Eloísa', () => {
    const data = buildCudyrReport(reportInput());
    expect(data.rows[0].hospitalAdmissionSource).toContain('Censo HHR');
    expect(cudyrReportTotals(data.rows)).toMatchObject({ eligible: 1, categorized: 1, review: 0 });
  });
});
