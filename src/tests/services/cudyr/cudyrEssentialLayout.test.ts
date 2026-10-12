import { describe, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrEssentialWorkbook } from '@/services/cudyr/cudyrEssentialWorkbook';
import { confirmedReportInput } from './reportFixtures';

const sample = () => {
  const data = buildCudyrReport(confirmedReportInput());
  const base = data.rows[0];
  base.evaluation!.category = 'C2';
  data.rows = [
    { ...base, key: 'one', date: '2026-10-01', patientName: 'Primera sintética' },
    { ...base, key: 'two', date: '2026-10-02', group: 'media' as const },
    ...Array.from({ length: 3 }, (_, i) => ({
      ...base,
      key: 'missing-' + i,
      date: '2026-10-02',
      patientName: `Sin registro ${i}`,
      cudyrStatus: 'sin_registro_observado' as const,
      evaluation: null,
    })),
    {
      ...base,
      key: 'excluded',
      date: '2026-10-02',
      eligibility: 'no_elegible' as const,
      eligibilityReason: 'Cuna RN sano',
      modality: 'cuna' as const,
    },
    {
      ...base,
      key: 'excluded-empty',
      date: '2026-10-02',
      eligibility: 'no_elegible' as const,
      eligibilityReason: 'CMA',
      modality: 'cma' as const,
      evaluation: null,
    },
  ];
  return data;
};

describe('monthly CUDYR format and calculation reconciliation', () => {
  it('roundtrips daily detail and weighted monthly totals in the legacy grid', async () => {
    const data = sample();
    const expected = cudyrReportTotals(data.rows);
    expect(expected).toMatchObject({ eligible: 5, categorized: 2, excluded: 2 });
    const { workbook: built } = await buildCudyrEssentialWorkbook(data);
    const workbook = new Workbook();
    await workbook.xlsx.load(await built.xlsx.writeBuffer());
    const summary = workbook.getWorksheet('Resumen CUDYR Mensual')!;
    const day = workbook.getWorksheet('02-10-2026')!;
    expect(day.getCell('B19').value).toBe(4);
    expect(day.getCell('B20').value).toBe(1);
    expect(day.getCell('B21').result).toBe(25);
    expect(summary.getCell('B20').result).toBe(expected.eligible);
    expect(summary.getCell('B21').result).toBe(expected.categorized);
    expect(summary.getCell('B22').result).toBe(40); // Not (100% + 25%) / 2.
    expect(summary.getCell('B20').formula).toContain("'02-10-2026'!B19");
    expect(summary.getCell('B11').result).toBe(1); // C2, intermedia.
    expect(summary.getCell('C11').result).toBe(1); // C2, media.
    expect(day.getCell('A24').value).toBe('Cama · Eloísa');
    expect(day.getCell('J30').value).toBe('No aplica');
    expect(day.getCell('K29').value).toBe('No elegible');
    expect(day.getCell('G29').value).toBeTruthy(); // Excluded result retained.
    for (const sheet of workbook.worksheets) {
      expect(sheet.getCell('B3').value).toBe('Cama intermedia');
      expect(sheet.getCell('C3').value).toBe('Cama media');
    }
    expect(day.getCell('B21').formula).toBe('IF(B19=0,"",ROUND(B20/B19*100,0))');
  });

  it('keeps unknown scores, author and time absent while retaining valid historical evidence', async () => {
    const data = sample();
    const row = data.rows[0];
    row.patientName = '=HYPERLINK("https://invalid.example")';
    row.rut = '0012345-K';
    row.evaluation = {
      ...row.evaluation!,
      author: '',
      recordedAt: '',
      dependencyScore: null,
      riskScore: null,
    };
    row.monthlyEvidence = {
      reportId: 'synthetic',
      state: 'found',
      sourceDate: '2026-10-02',
      checkedAt: data.generatedAt,
    };
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    const reopened = new Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const day = reopened.getWorksheet('01-10-2026')!;
    expect(day.getCell('C25').value).toBe(row.patientName);
    expect(day.getCell('C25').formula).toBeUndefined();
    expect(day.getCell('D25').value).toBe('0012345-K');
    expect(day.getCell('E25').value).not.toBe(0);
    expect(day.getCell('F25').value).not.toBe(0);
    expect(day.getCell('I25').value).toBe('Autor no informado\nNo informado');
    expect(day.getCell('M25').value).toBe('Eloísa · Excel de categorización');
    expect(day.getCell('B20').value).toBe(1);
  });

  it('does not present missing census or zero eligible days as 0% compliance', async () => {
    const data = sample();
    data.coverage = data.coverage.filter(day => day.date !== '2026-10-03');
    const { workbook } = await buildCudyrEssentialWorkbook(data);
    expect(workbook.getWorksheet('03-10-2026')!.getCell('A2').value).toContain('Sin censo');
    expect(workbook.getWorksheet('03-10-2026')!.getCell('B19').value).toBeNull();
    expect(workbook.getWorksheet('04-10-2026')!.getCell('B21').result).not.toBe(0);
    expect(workbook.getWorksheet('Resumen CUDYR Mensual')!.getCell('A2').value).toContain(
      'por verificar'
    );
  });
});
