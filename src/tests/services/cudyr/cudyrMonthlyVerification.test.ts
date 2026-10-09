import { describe, expect, it } from 'vitest';
import { verifyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyVerification';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
const archive = () =>
  ({ id: 'source', report: supplementRequest().report }) as ArchivedCudyrSupplement;
const data = () =>
  ({
    from: '2026-10-01',
    to: '2026-10-31',
    rows: [
      {
        key: 'case',
        date: '2026-10-02',
        patientName: 'Paciente Sintético',
        rut: 'ID-TEST',
        clinicalEpisodeId: 'episode',
        evaluation: null,
      },
    ],
    issues: [],
    coverage: [],
  }) as unknown as CudyrReportDataset;
describe('documentary monthly checks', () => {
  it('does not use report-level absence as evidence for a source patient cell', () => {
    const input = data();
    input.rows[0].monthlyEvidence = {
      reportId: 'source',
      sourceDate: '2026-10-03',
      checkedAt: '2026-11-02T18:00:00Z',
      state: 'absent',
    };
    input.rows[0].verifiedContext = {
      reviewedAt: '2026-11-02T18:00:00Z',
      reviewedBy: 'synthetic-reviewer',
      evidenceHashes: ['synthetic-hash'],
      applicationTimingBasis: 'assumed_before_0800',
      revision: 2,
      reason: 'Complete report query',
    };
    const checked = verifyCudyrMonthlySources(input, [archive()]);
    expect(checked.checks.some(check => check.date === '2026-10-03')).toBe(false);
  });
  it('keeps another source identity independent of reviewed whole-report absence', () => {
    const input = data(),
      source = archive();
    input.rows[0].patientName = 'Another patient';
    input.rows[0].rut = 'OTHER-DOCUMENT';
    input.rows[0].monthlyEvidence = {
      reportId: 'source',
      sourceDate: '2026-10-03',
      checkedAt: '2026-11-02T18:00:00Z',
      state: 'absent',
    };
    input.rows[0].verifiedContext = {
      reviewedAt: '2026-11-02T18:00:00Z',
      reviewedBy: 'synthetic-reviewer',
      evidenceHashes: ['synthetic-hash'],
      applicationTimingBasis: 'assumed_before_0800',
      revision: 2,
      reason: 'Complete report query',
    };
    expect(verifyCudyrMonthlySources(input, [source]).checks).toHaveLength(0);
  });
  it('does not hide October source absence because the patient appears in November', () => {
    const source = archive();
    source.report.month = '2026-11';
    source.report.patients[0].days = [
      {
        sourceDay: 5,
        sourceColumn: 5,
        sourceDate: '2026-11-05',
        originalValue: 'C2',
        category: 'C2',
        state: 'category',
      },
    ];
    const checks = verifyCudyrMonthlySources(data(), [source]).checks;
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ key: 'hhr:case', state: 'incomplete' });
  });
  it('accepts an already linked day-one result at the next-month boundary', () => {
    const input = data(),
      source = archive();
    input.rows[0].date = '2026-10-31';
    input.rows[0].monthlyEvidence = {
      reportId: 'source',
      sourceDate: '2026-11-01',
      checkedAt: '2026-11-02T18:00:00Z',
      state: 'found',
    };
    source.report.month = '2026-11';
    source.report.patients[0].days = [
      {
        sourceDay: 1,
        sourceColumn: 12,
        sourceDate: '2026-11-01',
        originalValue: 'C2',
        category: 'C2',
        state: 'category',
      },
    ];
    const checked = verifyCudyrMonthlySources(input, [source]);
    expect(checked.unresolved).toBe(0);
    expect(checked.checks.some(c => c.key === 'hhr:case')).toBe(false);
  });
  it('keeps a month-end case pending when only the prior report contains the patient', () => {
    const input = data();
    input.rows[0].date = '2026-10-31';
    expect(
      verifyCudyrMonthlySources(input, [archive()]).checks.find(c => c.key === 'hhr:case')?.state
    ).toBe('incomplete');
  });
  it('does not include day one of this month without an original timestamp proving this month', () => {
    expect(
      verifyCudyrMonthlySources(data(), [archive()]).checks.some(c => c.date === '2026-10-01')
    ).toBe(false);
  });
  it('keeps found categories even without HHR episode and does not mutate clinical data', () => {
    const input = data();
    const before = JSON.stringify(input);
    const source = archive();
    source.report.patients[0].days[2] = {
      ...source.report.patients[0].days[2],
      category: 'C2',
      originalValue: 'C2',
      state: 'category',
    };
    const checked = verifyCudyrMonthlySources(input, [source]);
    expect(checked.checks.find(c => c.state === 'found')).toMatchObject({
      result: 'C2',
      needsReview: true,
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(checked.censusIncomplete).toBe(true);
  });
  it('distinguishes a queried blank in observed stay from missing source and outside-stay blanks', () => {
    const checked = verifyCudyrMonthlySources(data(), [archive()]);
    expect(checked.checks.filter(c => c.state === 'empty').map(c => c.date)).toEqual([
      '2026-10-03',
    ]);
    expect(verifyCudyrMonthlySources(data(), []).checks[0].state).toBe('incomplete');
  });
  it('does not assign a shared RN document to a different person or episode', () => {
    const input = data();
    input.rows.push({
      ...input.rows[0],
      key: 'rn',
      patientName: 'RN de Paciente Sintético',
      clinicalEpisodeId: 'newborn',
    });
    const checked = verifyCudyrMonthlySources(input, [archive()]);
    expect(checked.checks.some(c => c.state === 'empty')).toBe(false);
    expect(checked.checks.filter(c => c.state === 'incomplete').length).toBeGreaterThan(0);
  });
  it('includes first day of next report without importing subsequent days into the previous month', () => {
    const source = archive();
    source.report.month = '2026-11';
    source.report.patients[0].days = [1, 2].map(n => ({
      sourceDay: n,
      sourceColumn: n,
      sourceDate: `2026-11-0${n}`,
      originalValue: 'C2',
      category: 'C2',
      state: 'category',
    }));
    const found = verifyCudyrMonthlySources(data(), [source]).checks.filter(
      c => c.state === 'found'
    );
    expect(found.map(c => c.date)).toEqual(['2026-11-01']);
    expect(found[0].needsReview).toBe(true);
  });
});
it('separates blank cells by episode/day when the patient was readmitted later', () => {
  const input = data();
  input.rows.push({
    ...input.rows[0],
    key: 'readmission',
    clinicalEpisodeId: 'second',
    date: '2026-10-10',
  });
  const checks = verifyCudyrMonthlySources(input, [archive()]).checks;
  expect(checks.find(c => c.date === '2026-10-03')).toMatchObject({
    state: 'empty',
    needsReview: false,
  });
});
