import { describe, expect, it } from 'vitest';
import { resolveRepeatedMonthlyEpisodes } from '@/services/cudyr/cudyrMonthlyEpisodeLink';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { verifyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyVerification';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput, reportRecord, reportPatient } from './reportFixtures';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';

const fixture = () => {
  const data = buildCudyrReport(
    confirmedReportInput({ records: [reportRecord('2026-10-02', { R1: reportPatient() })] })
  );
  const base = data.rows[0];
  data.from = '2026-10-01';
  data.to = '2026-10-31';
  data.generatedAt = '2026-11-02T20:00:00Z';
  data.rows = [1, 2, 3, 4, 12, 13, 14, 15].map(day => ({
    ...base,
    key: `day-${day}`,
    date: `2026-10-${String(day).padStart(2, '0')}`,
    clinicalEpisodeId: day < 10 ? 'episode-a' : 'episode-b',
    admissionDate: day < 10 ? '2026-10-01' : '2026-10-12',
    admissionTime: '12:00',
    admissionEvidenceConflict: false,
    resolvedSystemDeparture: [4, 15].includes(day),
    evaluation: null,
    cudyrStatus: 'sin_captura',
    contextSource: 'hhr_daily',
    warnings: [],
    applicationPending: false,
    eligibility: day === 1 ? 'no_elegible' : 'elegible',
  }));
  const report = supplementRequest().report;
  const p = report.patients[0];
  report.patients = [
    [2, 3],
    [13, 14],
  ].map((positive, index) => ({
    ...p,
    patientName: base.patientName,
    document: base.rut,
    sourceRow: 10 + index,
    days: p.days.map(d => ({
      ...d,
      category: positive.includes(d.sourceDay) ? 'C2' : null,
      originalValue: positive.includes(d.sourceDay) ? 'C2' : '',
      state: positive.includes(d.sourceDay) ? 'category' : 'blank',
    })),
  }));
  const source = {
    id: 'source',
    month: '2026-10',
    report,
    bytesVerified: true,
    importedAt: '2026-11-02T19:00:00Z',
    capture: { source: 'extension_monthly_report', observedAt: '2026-11-02T18:00:00Z' },
  } as ArchivedCudyrSupplement;
  return { data, report, source };
};

describe('repeated monthly identities resolved by episode timeline', () => {
  it('links separate stays without duplicating patient-days or changing eligibility', () => {
    const { data, report, source } = fixture();
    const before = JSON.stringify(data);
    expect([...resolveRepeatedMonthlyEpisodes(data, report)]).toEqual([
      [10, 'episode-a'],
      [11, 'episode-b'],
    ]);
    const output = applyCudyrMonthlySources(data, [source]);
    expect(output.rows).toHaveLength(data.rows.length);
    const found = output.rows.filter(r => r.evaluation);
    expect(found).toHaveLength(4);
    expect(found.every(r => r.monthlyEvidence?.linkMethod === 'episode_timeline')).toBe(true);
    expect(found.every(r => !r.warnings.some(w => w.includes('identidad o turno ambiguo')))).toBe(
      true
    );
    expect(found.find(r => r.date === '2026-10-01')?.eligibility).toBe('no_elegible');
    expect(
      verifyCudyrMonthlySources(output, [source])
        .checks.filter(c => c.state === 'found')
        .every(c => !c.needsReview)
    ).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('does not manufacture a census row on a missing day within a known stay', () => {
    const { data, source } = fixture();
    data.rows = data.rows.filter(r => r.date !== '2026-10-01');
    const output = applyCudyrMonthlySources(data, [source]);
    expect(output.rows.find(r => r.date === '2026-10-02')?.monthlyEvidence?.linkMethod).toBe(
      'episode_timeline'
    );
    const missing = output.rows.find(r => r.date === '2026-10-01')!;
    expect(missing.clinicalEpisodeId).toBe('');
    expect(missing.eligibility).toBe('por_revisar');
    expect(missing.bedId).toBe('');
  });
  it.each(['overlap', 'shared RUT', 'conflicting admission', 'missing episode', 'same episode'])(
    'refuses unsafe linkage: %s',
    kind => {
      const { data, report } = fixture();
      if (kind === 'overlap') report.patients[1].days[1].category = 'C2';
      if (kind === 'shared RUT')
        data.rows.push({
          ...data.rows[0],
          key: 'rn',
          patientName: 'RN DE ' + data.rows[0].patientName,
          clinicalEpisodeId: 'rn',
        });
      if (kind === 'conflicting admission') data.rows[0].admissionEvidenceConflict = true;
      if (kind === 'missing episode') data.rows[0].clinicalEpisodeId = '';
      if (kind === 'same episode')
        data.rows.forEach(r => {
          r.clinicalEpisodeId = 'one';
          r.admissionDate = '2026-10-01';
          r.resolvedSystemDeparture = false;
        });
      expect(resolveRepeatedMonthlyEpisodes(data, report).size).toBe(0);
    }
  );
  it('does not link a source row whose positive dates cross two episodes', () => {
    const { data, report } = fixture();
    report.patients[0].days[12].category = 'C2';
    report.patients[1].days[12].category = null;
    expect(resolveRepeatedMonthlyEpisodes(data, report).has(10)).toBe(false);
  });
  it('does not use category agreement as episode evidence', () => {
    const { data, report } = fixture();
    data.rows.push({ ...data.rows[0], key: 'competing', clinicalEpisodeId: 'competing' });
    expect(resolveRepeatedMonthlyEpisodes(data, report).has(10)).toBe(false);
  });
  it('does not assert absent cells for repeated stays after resolving their positives', () => {
    const { data, source } = fixture();
    const row = applyCudyrMonthlySources(data, [source]).rows.find(r => r.date === '2026-10-03')!;
    expect(row.cudyrStatus).toBe('sin_captura');
    expect(row.monthlyEvidence).toBeUndefined();
  });
});
