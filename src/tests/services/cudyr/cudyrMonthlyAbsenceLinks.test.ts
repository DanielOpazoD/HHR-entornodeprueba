import { describe, it, expect } from 'vitest';
import { applyCudyrMonthlyAbsenceLinks } from '@/services/cudyr/cudyrMonthlyAbsenceLinks';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { verifyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyVerification';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput, reportRecord, reportPatient } from './reportFixtures';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';

const make = () => {
  const data = buildCudyrReport(
    confirmedReportInput({ records: [reportRecord('2026-10-02', { R1: reportPatient() })] })
  );
  data.from = '2026-10-01';
  data.to = '2026-10-05';
  data.generatedAt = '2026-11-02T20:00:00Z';
  const row = data.rows[0];
  row.evaluation = null;
  row.cudyrStatus = 'sin_captura';
  row.applicationPending = false;
  const report = supplementRequest().report;
  report.patients = [report.patients[0]];
  const patient = report.patients[0];
  patient.patientName = row.patientName;
  patient.document = row.rut;
  patient.days = patient.days.map(d => ({
    ...d,
    category: d.sourceDay === 3 ? 'C2' : null,
    originalValue: d.sourceDay === 3 ? 'C2' : '',
    state: d.sourceDay === 3 ? 'category' : 'blank',
  }));
  const source = {
    id: 'archive',
    bytesVerified: true,
    month: '2026-10',
    report,
    importedAt: '2026-11-02T18:00:00Z',
    capture: { source: 'extension_monthly_report', observedAt: '2026-11-02T17:00:00Z' },
  } as ArchivedCudyrSupplement;
  const projected = applyCudyrMonthlySources(data, [source]);
  projected.rows.push({
    ...row,
    key: 'blank',
    date: '2026-10-03',
    warnings: ['Informe mensual: identidad o turno ambiguo; requiere cotejo.'],
  });
  return { data: projected, source };
};

describe('empty monthly cells after an established episode association', () => {
  it('confirms absence for the same episode without changing eligibility, census or scores', () => {
    const { data, source } = make();
    const before = structuredClone(data);
    const result = applyCudyrMonthlyAbsenceLinks(data, [source]);
    const row = result.rows.find(r => r.key === 'blank')!;
    expect(row.monthlyEvidence).toMatchObject({
      state: 'absent',
      sourceRow: source.report.patients[0].sourceRow,
      sourceDate: '2026-10-04',
      linkMethod: 'episode_timeline',
    });
    expect(row.cudyrStatus).toBe('sin_registro_observado');
    expect(row.evaluation).toBeNull();
    expect(row.eligibility).toBe(data.rows[1].eligibility);
    expect(row.warnings).toEqual([]);
    expect(data).toEqual(before);
    const check = verifyCudyrMonthlySources(result, [source]).checks.find(
      c => c.date === '2026-10-04'
    );
    expect(check).toMatchObject({ state: 'empty', needsReview: false });
  });
  it('does not conflate an RN sharing the document with the proven adult episode', () => {
    const { data, source } = make();
    data.rows.push({
      ...data.rows[1],
      key: 'rn',
      patientName: 'RN DE ' + data.rows[1].patientName,
      clinicalEpisodeId: 'rn',
    });
    const rows = applyCudyrMonthlyAbsenceLinks(data, [source]).rows;
    expect(rows.find(r => r.key === 'blank')?.monthlyEvidence?.state).toBe('absent');
    expect(rows.find(r => r.key === 'rn')?.monthlyEvidence).toBeUndefined();
  });
  it.each([
    'no anchor',
    'conflicting anchor',
    'unlinked positive',
    'two episodes',
    'shared episode identity',
    'two source rows',
    'concurrent candidate',
    'existing result',
    'unfinished source',
    'unparsed value',
    'nonempty value',
  ])('keeps verification pending for %s', kind => {
    const { data, source } = make();
    const anchor = data.rows[0],
      target = data.rows[1],
      patient = source.report.patients[0];
    if (kind === 'unparsed value') patient.days[3].state = 'uncategorized';
    if (kind === 'nonempty value') patient.days[3].originalValue = 'UNKNOWN';
    if (kind === 'no anchor') data.rows.shift();
    if (kind === 'conflicting anchor') anchor.monthlyEvidence!.state = 'conflict';
    if (kind === 'unlinked positive') patient.days[4].category = 'D2';
    if (kind === 'two episodes') target.clinicalEpisodeId = 'another';
    if (kind === 'shared episode identity') target.patientName = 'Another person';
    if (kind === 'two source rows') {
      source.report.patients.push({ ...patient, sourceRow: 99 });
      data.rows.push({
        ...anchor,
        key: 'anchor2',
        monthlyEvidence: { ...anchor.monthlyEvidence!, sourceRow: 99 },
      });
    }
    if (kind === 'concurrent candidate')
      data.rows.push({ ...target, key: 'duplicate', clinicalEpisodeId: 'other' });
    if (kind === 'existing result') target.evaluation = { ...anchor.evaluation! };
    if (kind === 'unfinished source') source.capture!.observedAt = '2026-10-02T10:00:00Z';
    expect(
      applyCudyrMonthlyAbsenceLinks(data, [source]).rows.find(r => r.key === 'blank')
        ?.monthlyEvidence
    ).toBeUndefined();
  });
  it('does not fill a blank from an older source after a newer report loses the proven association', () => {
    const { data, source } = make();
    const newer = structuredClone(source);
    newer.id = 'new';
    newer.capture!.observedAt = '2026-11-02T19:00:00Z';
    expect(
      applyCudyrMonthlyAbsenceLinks(data, [source, newer]).rows[1].monthlyEvidence
    ).toBeUndefined();
  });
  it('marks a validated census RUN absent from a complete final monthly report as no record', () => {
    const { data, source } = make();
    data.rows = data.rows.slice(1);
    data.rows[0].rut = '11.111.111-1';
    source.report.patients[0].document = '22.222.222-2';
    source.report.patients[0].patientName = 'Otra persona';
    const result = applyCudyrMonthlyAbsenceLinks(data, [source]);
    expect(result.rows[0].monthlyEvidence?.state).toBe('absent');
    expect(result.rows[0].cudyrStatus).toBe('sin_registro_observado');
    const incomplete = structuredClone(source);
    incomplete.bytesVerified = false;
    expect(
      applyCudyrMonthlyAbsenceLinks(data, [incomplete]).rows[0].monthlyEvidence
    ).toBeUndefined();
    const shared = structuredClone(source);
    shared.report.patients[0].document = '11111111-1';
    expect(applyCudyrMonthlyAbsenceLinks(data, [shared]).rows[0].monthlyEvidence).toBeUndefined();
  });
});

it('does not infer absence when a document-less positive has a compatible normalized name', () => {
  const { data, source } = make();
  const row = data.rows.find(r => r.key === 'blank')!;
  row.rut = '11.111.111-1';
  row.patientName = 'Ana Pérez';
  row.firstName = 'Ana';
  row.lastName = 'Pérez';
  source.report.patients[0].document = '';
  source.report.patients[0].patientName = 'Ana Urgencias Pérez';
  const result = applyCudyrMonthlyAbsenceLinks(data, [source]);
  expect(result.rows.find(r => r.key === 'blank')!.monthlyEvidence).toBeUndefined();
});
