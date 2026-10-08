import { describe, expect, it } from 'vitest';
import { buildCudyrRecoveryPlan, cudyrRecoveryGuidance } from '@/services/cudyr/cudyrRecoveryPlan';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrRecoveryWorkbook } from '@/services/cudyr/cudyrRecoveryWorkbook';
import { reportInput } from './reportFixtures';

describe('targeted historical recovery worklist', () => {
  it('keeps a crib-to-MQ transition daily and excludes all CMA days', () => {
    const data = buildCudyrReport(reportInput());
    const original = data.rows[0];
    data.rows = [
      {
        ...original,
        key: 'crib',
        date: '2026-10-01',
        modality: 'cuna',
        eligibility: 'no_elegible',
        evaluation: null,
      },
      {
        ...original,
        key: 'mq',
        date: '2026-10-02',
        modality: 'hospitalizacion',
        eligibility: 'elegible',
        evaluation: null,
      },
      {
        ...original,
        key: 'cma',
        date: '2026-10-03',
        modality: 'cma',
        eligibility: 'no_elegible',
        evaluation: null,
      },
    ];
    const before = JSON.stringify(data),
      plan = buildCudyrRecoveryPlan(data);
    expect(plan).toHaveLength(1);
    expect(plan[0].rows.map(r => r.row.key)).toEqual(['mq']);
    expect(plan[0].needs).toEqual(['evaluation']);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('does not merge readmissions or shared RN identifiers; inconsistent episodes cannot be opened', () => {
    const data = buildCudyrReport(reportInput()),
      row = data.rows[0];
    data.rows = [
      { ...row, evaluation: null },
      { ...row, key: 'readmission', clinicalEpisodeId: 'another', evaluation: null },
      { ...row, key: 'rn', clinicalEpisodeId: 'rn', patientName: 'RN sintético', evaluation: null },
    ];
    expect(buildCudyrRecoveryPlan(data)).toHaveLength(3);
    data.rows.push({
      ...row,
      key: 'inconsistent',
      rut: 'different',
      clinicalEpisodeId: ` ${row.clinicalEpisodeId} `,
      evaluation: null,
    });
    expect(
      buildCudyrRecoveryPlan(data)
        .filter(c => c.episodeId === row.clinicalEpisodeId)
        .every(c => !c.canOpenEpisode)
    ).toBe(true);
  });
  it('does not enable an empty or whitespace-only episode', () => {
    const data = buildCudyrReport(reportInput());
    data.rows[0].clinicalEpisodeId = '  ';
    const plan = buildCudyrRecoveryPlan(data);
    expect(plan[0].canOpenEpisode).toBe(false);
    expect(plan[0].episodeId).toBe('');
  });
  it('resolves unknown eligibility first and never labels an absence not applied', () => {
    const data = buildCudyrReport(reportInput());
    data.rows[0].eligibility = 'por_revisar';
    data.rows[0].evaluation = null;
    expect(buildCudyrRecoveryPlan(data)[0].needs).toEqual(['eligibility']);
  });
  it('preserves manual HHR results and points to their original source', () => {
    const data = buildCudyrReport(reportInput());
    const plan = buildCudyrRecoveryPlan(data);
    expect(plan[0].needs).toEqual(['metadata']);
    expect(cudyrRecoveryGuidance(plan[0])).toContain('respaldo manual HHR');
    data.rows[0].evaluation!.author = 'Autora HHR';
    data.rows[0].evaluation!.recordedAt = '2026-10-02T20:00:00-05:00';
    expect(buildCudyrRecoveryPlan(data)).toEqual([]);
  });
  it('does not prioritize a missing technical ID when the author and original date are known', () => {
    const data = buildCudyrReport(reportInput());
    data.rows[0].evaluation = {
      ...data.rows[0].evaluation!,
      source: 'Eloísa · Gestión de Camas',
      author: 'Autora sintética',
      recordedAt: '2026-10-02T20:00:00-05:00',
      sourceEvaluationId: '',
    };
    expect(buildCudyrRecoveryPlan(data)).toEqual([]);
    data.rows[0].evaluation.author = '  ';
    expect(buildCudyrRecoveryPlan(data)[0].needs).toEqual(['metadata']);
  });
  it('retains original application dates across month boundaries and exports only the selected cases', async () => {
    const data = buildCudyrReport(reportInput());
    const row = data.rows[0];
    row.evaluation = {
      category: 'C2',
      source: 'Eloísa · Gestión de Camas',
      recordedAt: '2026-11-01T03:00:00-05:00',
      author: '',
      authorId: '',
      authorRole: '',
      sourceEvaluationId: 'known',
    };
    data.rows.push({ ...row, key: 'other', clinicalEpisodeId: 'other', rut: 'other' });
    const plan = buildCudyrRecoveryPlan(data);
    const workbook = await buildCudyrRecoveryWorkbook(data, [plan[0]]);
    const sheet = workbook.getWorksheet('Búsqueda dirigida')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('N2').value).toBe('2026-11-01T03:00:00-05:00');
    expect(sheet.getCell('F2').value).toBe('Intermedia');
    expect(workbook.getWorksheet('Alcance')!.getCell('B2').value).toContain(
      'No es el reporte para Estadística'
    );
    await expect(buildCudyrRecoveryWorkbook(data, Array(21).fill(plan[0]))).rejects.toThrow('20 casos');
  });
});
