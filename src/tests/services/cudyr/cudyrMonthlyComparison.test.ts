import { describe, expect, it } from 'vitest';
import { compareCudyrMonth, cudyrMonthlyInventory } from '@/services/cudyr/cudyrMonthlyComparison';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import type { CudyrSupplementReport } from '@/types/domain/cudyrSupplement';
import { reportInput } from './reportFixtures';
const dataset = () => {
  const d = buildCudyrReport(reportInput());
  d.from = '2026-07-01';
  d.to = '2026-07-31';
  const r = d.rows[0];
  r.date = '2026-07-19';
  r.patientName = 'Paciente Sintético';
  r.rut = 'ID-TEST';
  r.evaluation = {
    category: 'C2',
    source: 'Eloísa · Gestión de Camas',
    recordedAt: '2026-07-20T03:00:00-06:00',
    sourceEvaluationId: '',
    author: 'Autora Sintética',
    authorId: '',
    authorRole: '',
  };
  return d;
};
const report = (category = 'C2', date = '2026-07-20'): CudyrSupplementReport => ({
  schemaVersion: 1,
  source: 'eloisa_monthly_report',
  month: '2026-07',
  establishment: 'Hospital Hanga Roa',
  generatedLabel: '',
  sheet: 'Synthetic',
  patients: [
    {
      sourceRow: 5,
      ordinal: 1,
      patientName: 'Paciente Sintético',
      document: 'ID-TEST',
      clinicalRecord: '',
      diagnosis: '',
      hospitalDays: '',
      service: '',
      dischargeCondition: '',
      days: [
        {
          sourceDay: Number(date.slice(-2)),
          sourceColumn: 12,
          sourceDate: date,
          originalValue: category,
          category: category === 'S/C' ? null : category,
          state: category === 'S/C' ? 'uncategorized' : 'category',
        },
      ],
    },
  ],
});
describe('read-only monthly reconciliation', () => {
  it('compares source calendar dates without overwriting census date, exclusions or totals', () => {
    const d = dataset();
    d.rows[0].eligibility = 'no_elegible';
    d.rows[0].modality = 'cma';
    const before = JSON.stringify(d);
    expect(compareCudyrMonth(d, report())[0]).toMatchObject({
      status: 'compatible',
      sourceDate: '2026-07-20',
      candidateKeys: [d.rows[0].key],
    });
    expect(JSON.stringify(d)).toBe(before);
  });
  it('retains a genuine category difference and explicit S/C as documentary disagreement', () => {
    for (const category of ['C1', 'S/C'])
      expect(compareCudyrMonth(dataset(), report(category))[0].status).toBe('category_difference');
  });
  it('does not match an unrelated application simply because its census date equals the source day', () => {
    expect(compareCudyrMonth(dataset(), report('C2', '2026-07-19'))[0].status).toBe('date_review');
  });
  it('keeps manual results and missing dates separate from source applications', () => {
    const d = dataset();
    d.rows[0].evaluation!.recordedAt = '';
    d.rows[0].evaluation!.source = 'HHR · puntuación manual';
    const result = compareCudyrMonth(d, report('C2', '2026-07-19'));
    expect(result.map(r => r.status)).toEqual(['date_review', 'hhr_only']);
    expect(cudyrMonthlyInventory(d).manual).toBe(1);
  });
  it('does not fuse a newborn and another identity sharing a document', () => {
    const d = dataset();
    d.rows.push({
      ...d.rows[0],
      key: 'newborn',
      clinicalEpisodeId: 'rn',
      patientName: 'RN Sintético',
      modality: 'cuna',
      eligibility: 'no_elegible',
    });
    expect(compareCudyrMonth(d, report())[0].status).toBe('identity_review');
  });
  it('recognizes shared identities in the source even if only one is present in HHR', () => {
    const r = report();
    r.patients.push({ ...r.patients[0], sourceRow: 6, patientName: 'RN Sintético' });
    expect(
      compareCudyrMonth(dataset(), r)
        .filter(x => x.source === 'Categorización Eloísa')
        .every(x => x.status === 'identity_review')
    ).toBe(true);
  });
  it('never reuses one HHR result to reconcile duplicate documentary identities', () => {
    for (const category of ['C2', 'C1']) {
      const r = report();
      r.patients.push({
        ...report(category).patients[0],
        sourceRow: 6,
        clinicalRecord: 'ANOTHER-FICHA',
      });
      const compared = compareCudyrMonth(dataset(), r);
      expect(compared.slice(0, 2).map(x => x.status)).toEqual([
        'identity_review',
        'identity_review',
      ]);
      expect(compared[2].status).toBe('hhr_only');
    }
  });
  it('does not choose an episode from two same-name re-admission candidates by category', () => {
    const d = dataset();
    d.rows.push({
      ...d.rows[0],
      key: 'readmission',
      clinicalEpisodeId: 'other',
      evaluation: { ...d.rows[0].evaluation!, category: 'D3' },
    });
    expect(compareCudyrMonth(d, report())[0].status).toBe('identity_review');
  });
  it('keeps missing episode, missing document and mismatched name pending', () => {
    for (const patch of [{ clinicalEpisodeId: '' }, { patientName: 'Otra Persona' }]) {
      const d = dataset();
      Object.assign(d.rows[0], patch);
      expect(compareCudyrMonth(d, report())[0].status).toBe('identity_review');
    }
    const r = report();
    r.patients[0].document = '';
    expect(compareCudyrMonth(dataset(), r)[0].status).toBe('identity_review');
  });
  it('flags next-month evidence rather than losing the final night shift', () => {
    const d = dataset();
    d.rows[0].date = '2026-07-31';
    d.rows[0].evaluation!.recordedAt = '2026-08-01T03:00:00-06:00';
    expect(compareCudyrMonth(d, { ...report(), patients: [] })[0]).toMatchObject({
      status: 'hhr_only',
      sourceDate: '2026-08-01',
    });
    expect(compareCudyrMonth(d, { ...report(), patients: [] })[0].reason).toContain('otro mes');
  });
  it('does not convert a blank cell or an absent HHR result into noncompliance', () => {
    const r = report();
    r.patients[0].days[0].state = 'blank';
    r.patients[0].days[0].category = null;
    expect(compareCudyrMonth(dataset(), r).every(x => x.status === 'hhr_only')).toBe(true);
    const d = dataset();
    d.rows[0].evaluation = null;
    expect(compareCudyrMonth(d, report('C2', '2026-07-19'))[0].status).toBe('no_hhr_result');
  });
  it('leaves discharge context provisional and preserves each original discharge row', () => {
    const d = dataset();
    const before = JSON.stringify(d);
    const row = {
      sourceRow: 5,
      patientName: 'Paciente Sintético',
      document: 'ID-TEST',
      date: '2026-07-21',
      time: '12:00',
      bed: 'Cuna H1C1',
      service: 'MQ',
      diagnosis: 'Sintético',
    };
    const result = compareCudyrMonth(d, undefined, {
      from: d.from,
      to: d.to,
      generatedLabel: '',
      rows: [row, { ...row, sourceRow: 6 }],
    });
    expect(result).toHaveLength(2);
    expect(result.every(r => r.status === 'discharge_review')).toBe(true);
    expect(JSON.stringify(d)).toBe(before);
  });
});
