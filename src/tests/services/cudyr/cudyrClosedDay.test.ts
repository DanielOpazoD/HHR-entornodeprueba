import { describe, expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrEssentialWorkbook } from '@/services/cudyr/cudyrEssentialWorkbook';
import { reportInput, reportObservation, reportPatient, reportRecord } from './reportFixtures';

const discharge = (date: string, status: 'Vivo' | 'Fallecido' = 'Vivo') => ({
  id: 'departure',
  clinicalEpisodeId: 'synthetic-episode',
  bedId: 'R1',
  bedName: 'R1',
  bedType: 'irrelevant',
  patientName: 'Paciente Sintético',
  rut: 'synthetic-rut',
  diagnosis: 'Sintético',
  time: '23:00',
  movementDate: date,
  status,
  originalData: reportPatient(),
});
describe('CUDYR closed census days', () => {
  it.each(['Vivo', 'Fallecido'] as const)(
    'excludes a same-day discharge (%s) even after an early evaluation',
    async status => {
      const record = reportRecord();
      record.discharges = [discharge(record.date, status)];
      const observation = reportObservation();
      observation.evaluation.recordedAt = '2026-10-02T20:00:00-05:00';
      const data = buildCudyrReport(
        reportInput({ records: [record], observations: [observation] })
      );
      expect(data.rows[0].eligibility).toBe('no_elegible');
      expect(data.rows[0].evaluation?.category).toBe('C2');
      expect(cudyrReportTotals(data.rows)).toMatchObject({
        eligible: 0,
        categorized: 0,
        excluded: 1,
      });
      const { workbook } = await buildCudyrEssentialWorkbook(data);
      expect(workbook.getWorksheet('Pacientes elegibles')!.rowCount).toBe(1);
    }
  );
  it('excludes external transfer on the census day, without excluding earlier days of the episode', () => {
    const record = reportRecord('2026-10-03');
    record.transfers = [
      {
        ...discharge('2026-10-03'),
        evacuationMethod: 'Avión',
        receivingCenter: 'Centro sintético',
        transferEscort: 'Enfermera',
      },
    ];
    const observation = reportObservation({ censusDate: '2026-10-03' });
    observation.evaluation.recordedAt = '2026-10-03T20:00:00-05:00';
    const data = buildCudyrReport(
      reportInput({ records: [reportRecord(), record], observations: [observation] })
    );
    expect(data.rows.map(row => [row.date, row.eligibility])).toEqual([
      ['2026-10-02', 'elegible'],
      ['2026-10-03', 'no_elegible'],
    ]);
  });
  it('excludes a known same-day departure without requiring its hour', () => {
    const record = reportRecord();
    record.discharges = [{ ...discharge(record.date), time: '' }];
    expect(buildCudyrReport(reportInput({ records: [record] })).rows[0].eligibility).toBe(
      'no_elegible'
    );
  });
  it.each([
    ['2026-10-03T00:30:00-05:00', true],
    ['2026-10-03T11:59:00-05:00', true],
    ['2026-10-03T12:00:00-05:00', false],
  ] as const)('respects the existing Rapa Nui application window at %s', (generatedAt, pending) => {
    const data = buildCudyrReport(reportInput({ generatedAt }));
    expect(data.rows[0].applicationPending).toBe(pending);
    expect(cudyrReportTotals(data.rows).eligible).toBe(pending ? 0 : 1);
  });
  it('omits the current and future census days from totals and essential detail even if they have results', async () => {
    const data = buildCudyrReport(
      reportInput({
        generatedAt: '2026-10-03T20:00:00-05:00',
        records: [reportRecord(), reportRecord('2026-10-03'), reportRecord('2026-10-04')],
      })
    );
    expect(cudyrReportTotals(data.rows)).toMatchObject({ eligible: 1, categorized: 1 });
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.getWorksheet('Pacientes elegibles')!.rowCount).toBe(2);
    const summary = workbook.getWorksheet('Resumen')!;
    expect(summary.getCell('D4').value).toBe('');
    expect(summary.getCell('G4').value).toContain('Pendiente de aplicación');
  });
});
