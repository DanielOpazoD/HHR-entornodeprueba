import { cudyrEligibilityOrigin } from '@/services/cudyr/cudyrDailyControl';
import { describe, expect, it } from 'vitest';
import {
  applyCudyrVerifiedContexts,
  type CudyrVerifiedContext,
} from '@/services/cudyr/cudyrVerifiedContext';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput, reportRecord, reportPatient } from './reportFixtures';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
const setup = () => {
  const data = buildCudyrReport(
    confirmedReportInput({
      records: [reportRecord('2026-10-02', { R1: reportPatient({ clinicalEpisodeId: '123' }) })],
    })
  );
  data.generatedAt = '2026-11-02T20:00:00Z';
  data.rows[0].evaluation = null;
  const report = supplementRequest().report;
  report.patients = [
    {
      ...report.patients[0],
      patientName: 'Persona recuperada',
      document: 'PAS123',
      days: report.patients[0].days.map(d => ({
        ...d,
        category: d.sourceDay === 3 ? 'C2' : null,
        originalValue: d.sourceDay === 3 ? 'C2' : '',
        state: d.sourceDay === 3 ? 'category' : 'blank',
      })),
    },
  ];
  const source = {
    id: 'source',
    month: '2026-10',
    report,
    bytesVerified: true,
    importedAt: '2026-11-02T19:00:00Z',
    capture: { source: 'extension_monthly_report', observedAt: '2026-11-02T18:00:00Z' },
  } as ArchivedCudyrSupplement;
  const review: CudyrVerifiedContext = {
    schemaVersion: 1,
    month: '2026-10',
    revision: 1,
    updatedAt: '2026-11-03T18:00:00Z',
    reviewedBy: { uid: 'reviewer', name: 'Revisor', email: 'test@example.com', role: 'admin' },
    verification: 'reviewed_documentary_context',
    files: [],
    entries: [
      {
        date: '2026-10-02',
        reportId: 'source',
        sourceRow: report.patients[0].sourceRow,
        clinicalEpisodeId: '123',
        admissionAt: '2026-10-02T14:00:00-05:00',
        dischargeAt: '2026-10-04T14:00:00-05:00',
        group: 'intermedia',
        modality: 'hospitalizacion',
        bedId: 'R1',
        bedName: 'R1',
        document: 'PAS123',
        documentType: 'Pasaporte',
        basis: 'reviewed_documentary_context',
        reason: 'Identidad y estadía cotejadas con documentación del episodio.',
        evidenceHashes: [],
      },
    ],
  };
  return { data: applyCudyrMonthlySources(data, [source]), source, review };
};
describe('reviewed documentary context projection', () => {
  it('merges a recovered identity into its episode without double counting or inventing a time', () => {
    const { data, source, review } = setup();
    expect(data.rows).toHaveLength(2);
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      clinicalEpisodeId: '123',
      rut: 'PAS123',
      eligibility: 'elegible',
      evaluation: { category: 'C2', recordedAt: '', author: '' },
      verifiedContext: { applicationTimingBasis: 'assumed_before_0800' },
    });
    expect(cudyrReportTotals(out.rows).eligible).toBe(1);
  });
  it('reconstructs an omitted stay without inventing a physical bed', () => {
    const { data, source, review } = setup();
    data.rows = data.rows.filter(r => !r.clinicalEpisodeId);
    review.entries[0].bedId = '';
    review.entries[0].bedName = '';
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0]).toMatchObject({
      bedId: '',
      bedName: 'Hospitalizados · código no informado',
      group: 'intermedia',
      eligibility: 'elegible',
    });
  });
  it.each(['cuna', 'cma', 'uea'] as const)('retains the real score but excludes %s', modality => {
    const { data, source, review } = setup();
    review.entries[0].modality = modality;
    review.entries[0].group = 'sin_grupo';
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0]).toMatchObject({ eligibility: 'no_elegible', cudyrStatus: 'registrado' });
  });
  it('uses fixed 01:00 duration, not application time', () => {
    const { data, source, review } = setup();
    review.entries[0].admissionAt = '2026-10-03T00:39:00-05:00';
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0].eligibility).toBe('no_elegible');
    expect(out.rows[0].evaluation?.category).toBe('C2');
  });
  it('keeps manual exclusions and original author/time', () => {
    const { data, source, review } = setup();
    const row = data.rows.find(r => r.clinicalEpisodeId)!;
    row.exclusion = { reason: 'not_hospitalized' } as typeof row.exclusion;
    row.eligibility = 'no_elegible';
    row.eligibilityReason = 'Exclusión manual';
    row.evaluation = {
      category: 'C2',
      source: 'Eloísa',
      recordedAt: '2026-10-03T03:00:00-05:00',
      author: 'Autor original',
      sourceEvaluationId: '1',
      authorId: 'a',
      authorRole: 'nurse',
    };
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0]).toMatchObject({
      eligibility: 'no_elegible',
      eligibilityReason: 'Exclusión manual',
      evaluation: { author: 'Autor original' },
      verifiedContext: { applicationTimingBasis: 'recorded_time' },
    });
  });
  it('preserves a manually confirmed physical departure despite a later administrative discharge', () => {
    const { data, source, review } = setup();
    const row = data.rows.find(r => r.clinicalEpisodeId)!;
    row.correction = {
      actualDischarge: { date: '2026-10-02', time: '20:00', timeZone: 'Pacific/Easter' },
    } as typeof row.correction;
    row.resolvedSystemDeparture = false;
    row.eligibility = 'no_elegible';
    row.eligibilityReason = 'Egreso real confirmado manualmente';
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0]).toMatchObject({
      eligibility: 'no_elegible',
      eligibilityReason: 'Egreso real confirmado manualmente',
      resolvedSystemDeparture: false,
      correction: row.correction,
      cudyrStatus: 'registrado',
      evaluation: { category: 'C2' },
    });
  });
  it('does not erase conflicting scores or substitute another episode', () => {
    const { data, source, review } = setup();
    const monthly = data.rows.find(r => !r.clinicalEpisodeId)!;
    monthly.clinicalEpisodeId = '456';
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows).toHaveLength(2);
    expect(out.issues).toHaveLength(1);
  });
  it('does not apply unverified bytes', () => {
    const { data, source, review } = setup();
    source.bytesVerified = false;
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows).toHaveLength(2);
    expect(out.issues).toHaveLength(1);
  });
  it('is idempotent', () => {
    const { data, source, review } = setup();
    const once = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(applyCudyrVerifiedContexts(once, [source], [review])).toEqual(once);
  });
});

it('retains a reviewed omitted stay after a later identical monthly download changes source row order', () => {
  const { data, source, review } = setup();
  data.rows = data.rows.filter(r => !r.clinicalEpisodeId);
  const newer = structuredClone(source);
  newer.id = 'new-download';
  newer.report.patients[0].sourceRow += 1;
  data.rows[0].monthlyEvidence!.reportId = newer.id;
  data.rows[0].monthlyEvidence!.sourceRow = newer.report.patients[0].sourceRow;
  const out = applyCudyrVerifiedContexts(data, [source, newer], [review]);
  expect(out.rows).toHaveLength(1);
  expect(out.rows[0].clinicalEpisodeId).toBe('123');
  expect(out.issues).toEqual([]);
});

it('preserves richer author/time on a consumed source row instead of synthesizing blank metadata', () => {
  const { data, source, review } = setup();
  const sourceRow = data.rows.find(r => !r.clinicalEpisodeId)!;
  sourceRow.evaluation = {
    ...sourceRow.evaluation!,
    author: 'Autora original',
    recordedAt: '2026-10-03T03:00:00-05:00',
    sourceEvaluationId: 'source-event',
  };
  sourceRow.evaluationCount = 2;
  const out = applyCudyrVerifiedContexts(data, [source], [review]);
  expect(out.rows[0]).toMatchObject({
    evaluation: {
      author: 'Autora original',
      recordedAt: '2026-10-03T03:00:00-05:00',
      sourceEvaluationId: 'source-event',
    },
    evaluationCount: 2,
    verifiedContext: { applicationTimingBasis: 'recorded_time' },
  });
});

it('labels reviewed context truthfully in the essential Excel', () => {
  const { data, source, review } = setup();
  const out = applyCudyrVerifiedContexts(data, [source], [review]);
  expect(cudyrEligibilityOrigin(out.rows[0])).toBe('Conciliación documental verificada');
});

describe('reviewed whole-report absence', () => {
  const absence = () => {
    const { data, source, review } = setup();
    data.rows = data.rows.filter(r => r.clinicalEpisodeId === '123');
    const row = data.rows[0];
    row.monthlyEvidence = undefined;
    row.evaluation = null;
    review.entries[0] = {
      ...review.entries[0],
      sourceRow: null,
      basis: 'reviewed_report_absence',
      document: row.rut,
      patientName: row.patientName,
    };
    return { data, source, review };
  };
  it.each(['2026-10-02T10:00:00-05:00', '2026-10-02T20:00:00-05:00'])(
    'keeps UEA as the exclusion reason for a reconstructed absence admitted at %s',
    admissionAt => {
      const { data, source, review } = absence();
      data.rows = [];
      review.entries[0].modality = 'uea';
      review.entries[0].group = 'sin_grupo';
      review.entries[0].admissionAt = admissionAt;
      review.entries[0].evidenceHashes = ['a'.repeat(64)];
      const out = applyCudyrVerifiedContexts(data, [source], [review]);
      expect(out.issues).toEqual([]);
      expect(out.rows[0]).toMatchObject({
        eligibility: 'no_elegible',
        eligibilityReason: 'UEA: cama de Urgencias excluida de CUDYR.',
        cudyrStatus: 'sin_registro_observado',
      });
    }
  );
  it('uses verified identity and report without changing eligibility or census context', () => {
    const { data, source, review } = absence();
    const before = structuredClone(data.rows[0]);
    const row = applyCudyrVerifiedContexts(data, [source], [review]).rows[0];
    expect(row).toMatchObject({
      cudyrStatus: 'sin_registro_observado',
      evaluation: null,
      monthlyEvidence: { state: 'absent', sourceDate: '2026-10-03' },
      verifiedContext: { revision: 1 },
    });
    expect(row.monthlyEvidence?.sourceRow).toBeUndefined();
    for (const field of [
      'eligibility',
      'bedId',
      'admissionDate',
      'admissionTime',
      'contextSource',
    ] as const)
      expect(row[field]).toEqual(before[field]);
    expect(data.rows[0]).toEqual(before);
  });
  it.each([
    'document',
    'name',
    'month',
    'unverified bytes',
    'matching document',
    'matching name',
    'competing later report',
    'duplicate target',
  ])('does not assert absence with %s', kind => {
    const { data, source, review } = absence();
    const e = review.entries[0];
    const sources = [source];
    if (kind === 'document') e.document = 'different';
    if (kind === 'name') e.patientName = 'Another person';
    if (kind === 'month') source.report.month = '2026-09';
    if (kind === 'unverified bytes') source.bytesVerified = false;
    if (kind === 'matching document') source.report.patients[0].document = e.document;
    if (kind === 'matching name') source.report.patients[0].patientName = e.patientName!;
    if (kind === 'duplicate target') data.rows.push({ ...data.rows[0], key: 'other' });
    if (kind === 'competing later report') {
      const newer = structuredClone(source);
      newer.id = 'newer';
      newer.report.patients[0].document = e.document;
      sources.push(newer);
    }
    const out = applyCudyrVerifiedContexts(data, sources, [review]);
    expect(out.rows[0].monthlyEvidence).toBeUndefined();
    expect(out.issues.length).toBeGreaterThan(0);
  });
  it('uses a fully verified empty report as evidence of no record', () => {
    const { data, source, review } = absence();
    source.report.patients = [];
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0].monthlyEvidence?.state).toBe('absent');
    expect(out.issues).toEqual([]);
  });
  it('separates a documentary RN identity from its mother without copying her result', () => {
    const { data, source, review } = absence();
    const e = review.entries[0];
    e.modality = 'cuna';
    e.group = 'sin_grupo';
    e.maternalSourceRow = source.report.patients[0].sourceRow;
    source.report.patients[0].document = e.document;
    source.report.patients[0].patientName = 'Madre Apellido';
    const out = applyCudyrVerifiedContexts(data, [source], [review]);
    expect(out.rows[0].monthlyEvidence?.state).toBe('absent');
    expect(out.rows[0].evaluation).toBeNull();
    expect(out.issues).toEqual([]);
    const competing = structuredClone(source.report.patients[0]);
    competing.sourceRow += 1;
    competing.patientName = 'RN de Madre Apellido';
    source.report.patients.push(competing);
    expect(applyCudyrVerifiedContexts(data, [source], [review]).issues).toHaveLength(1);
  });
  it('preserves a subsequently recovered positive', () => {
    const { data, source, review } = absence();
    const positive = {
      category: 'C2',
      source: 'Eloísa',
      recordedAt: '2026-10-03T03:00:00-05:00',
      author: 'Enfermería',
      authorId: '',
      authorRole: '',
      sourceEvaluationId: 'found',
    };
    data.rows[0].evaluation = positive;
    data.rows[0].cudyrStatus = 'registrado';
    const row = applyCudyrVerifiedContexts(data, [source], [review]).rows[0];
    expect(row.evaluation).toEqual(positive);
    expect(row.monthlyEvidence).toBeUndefined();
    expect(row.cudyrStatus).toBe('registrado');
  });
});
