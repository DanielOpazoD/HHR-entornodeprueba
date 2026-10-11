import { describe, it, expect } from 'vitest';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput, reportRecord, reportPatient } from './reportFixtures';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
const make = () => {
  const data = buildCudyrReport(
    confirmedReportInput({ records: [reportRecord('2026-10-02', { R1: reportPatient() })] })
  );
  data.generatedAt = '2026-11-02T20:00:00Z';
  data.rows[0].evaluation = null;
  data.rows[0].cudyrStatus = 'sin_captura';
  data.rows[0].eligibility = 'elegible';
  data.rows[0].applicationPending = false;
  const report = supplementRequest().report;
  report.patients[0].patientName = data.rows[0].patientName;
  report.patients[0].document = data.rows[0].rut;
  report.patients[0].days = report.patients[0].days.map(d => ({
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
  return { data, source };
};
describe('official monthly CUDYR projection', () => {
  it.each(['blank', 'missing patient'])(
    'keeps a prior positive when the newer source has %s',
    kind => {
      const { data, source } = make();
      const newer = structuredClone(source);
      newer.id = 'newer';
      newer.capture!.observedAt = '2026-11-02T18:00:00Z';
      newer.importedAt = '2026-11-02T19:00:00Z';
      if (kind === 'missing patient') newer.report.patients = [];
      else
        newer.report.patients[0].days.forEach(d => {
          d.category = null;
        });
      const row = applyCudyrMonthlySources(data, [newer, source]).rows[0];
      expect(row.evaluation?.category).toBe('C2');
      expect(row.cudyrStatus).toBe('registrado');
      expect(row.warnings.some(w => w.includes('informe anterior'))).toBe(true);
      if (kind === 'blank') expect(row.monthlyEvidence?.state).toBe('conflict');
    }
  );
  it('uses the newest positive without duplicating recovered rows across report versions', () => {
    const { data, source } = make();
    data.rows = [];
    const newer = structuredClone(source);
    newer.id = 'newer';
    newer.capture!.observedAt = '2026-11-02T18:00:00Z';
    newer.report.patients[0].days[2].category = 'B2';
    const rows = applyCudyrMonthlySources(data, [newer, source]).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].evaluation?.category).toBe('B2');
    expect(rows[0].monthlyEvidence?.reportId).toBe('newer');
    expect(rows[0].monthlyEvidence?.state).toBe('conflict');
    expect(rows[0].cudyrStatus).toBe('por_revisar');
    rows[0].eligibility = 'elegible';
    rows[0].group = 'media';
    expect(cudyrReportTotals(rows).categorized).toBe(0);
    expect(rows[0].warnings.some(w => w.includes('categorías diferentes'))).toBe(true);
  });
  it.each(['readmission', 'shared document', 'unknown episode'])(
    'does not assert a blank as absent with %s',
    kind => {
      const { data, source } = make();
      source.report.patients[0].days.forEach(d => {
        d.category = null;
      });
      if (kind === 'readmission')
        data.rows.push({
          ...data.rows[0],
          key: 'other',
          date: '2026-10-05',
          clinicalEpisodeId: 'other',
        });
      if (kind === 'shared document')
        data.rows.push({
          ...data.rows[0],
          key: 'rn',
          patientName: 'RN DE ' + data.rows[0].patientName,
          clinicalEpisodeId: 'rn',
        });
      if (kind === 'unknown episode') data.rows[0].clinicalEpisodeId = '';
      const row = applyCudyrMonthlySources(data, [source]).rows.find(
        r => r.key === data.rows[0].key
      )!;
      expect(row.cudyrStatus).toBe('sin_captura');
      expect(row.monthlyEvidence).toBeUndefined();
    }
  );
  it('does not let a delayed old capture replace a newer final source', () => {
    const { data, source } = make();
    const stale = structuredClone(source);
    stale.id = 'delayed';
    stale.capture!.observedAt = '2026-10-03T15:00:00Z';
    stale.importedAt = '2026-11-02T19:00:00Z';
    stale.report.patients[0].days.forEach(d => {
      d.category = null;
    });
    expect(applyCudyrMonthlySources(data, [source, stale]).rows[0].monthlyEvidence?.reportId).toBe(
      'archive'
    );
    expect(applyCudyrMonthlySources(data, [source, stale]).rows[0].evaluation?.category).toBe('C2');
  });
  it('keeps a mother and newborn with a shared document distinct by their full names', () => {
    const { data, source } = make();
    const mother = data.rows[0].patientName;
    data.rows.push({
      ...data.rows[0],
      key: 'newborn',
      clinicalEpisodeId: 'newborn',
      patientName: 'RN DE ' + mother,
    });
    source.report.patients.push({
      ...source.report.patients[0],
      sourceRow: 99,
      patientName: 'RN DE ' + mother,
    });
    const rows = applyCudyrMonthlySources(data, [source]).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.contextSource !== 'eloisa_monthly_report')).toBe(true);
    expect(rows.map(r => r.clinicalEpisodeId)).toContain('newborn');
  });

  it('links a surname-first report only with compatible structured census names', () => {
    const { data, source } = make();
    data.rows[0].patientName = 'Ana María Pérez Soto';
    data.rows[0].firstName = 'Ana María';
    data.rows[0].lastName = 'Pérez';
    data.rows[0].secondLastName = 'Soto';
    source.report.patients[0].patientName = 'PEREZ SOTO ANA MARIA';
    const rows = applyCudyrMonthlySources(data, [source]).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].evaluation?.category).toBe('C2');
    expect(rows[0].clinicalEpisodeId).toBe(data.rows[0].clinicalEpisodeId);
  });
  it('does not guess an identity from partial names or a shared document', () => {
    const { data, source } = make();
    data.rows[0].patientName = 'Ana María Pérez Soto';
    source.report.patients[0].patientName = 'Ana Pérez';
    const rows = applyCudyrMonthlySources(data, [source]).rows;
    expect(rows.find(r => r.key === data.rows[0].key)?.evaluation).toBeNull();
    expect(rows.some(r => r.contextSource === 'eloisa_monthly_report')).toBe(true);
  });
  it.each(['00:05', '03:00', '11:59'])(
    'retains CUDYR at %s regardless of the 01:00 eligibility reference',
    time => {
      const { data, source } = make();
      const recordedAt = `2026-10-03T${time}:00-05:00`;
      data.rows[0].eligibility = 'no_elegible';
      data.rows[0].evaluation = {
        category: 'C2',
        source: 'Eloísa',
        recordedAt,
        author: 'Profesional',
        authorId: '',
        authorRole: '',
        sourceEvaluationId: 'application',
      };
      const row = applyCudyrMonthlySources(data, [source]).rows[0];
      expect(row.date).toBe('2026-10-02');
      expect(row.evaluation?.recordedAt).toBe(recordedAt);
      expect(row.eligibility).toBe('no_elegible');
      expect(row.monthlyEvidence?.state).toBe('found');
    }
  );

  it.each(['missing document', 'duplicate identity', 'multiple candidates'])(
    'retains unlinked official positives: %s',
    kind => {
      const { data, source } = make();
      if (kind === 'missing document') source.report.patients[0].document = '';
      if (kind === 'duplicate identity')
        source.report.patients.push({ ...source.report.patients[0], sourceRow: 6, ordinal: 2 });
      if (kind === 'multiple candidates')
        data.rows.push({ ...data.rows[0], key: 'second', clinicalEpisodeId: 'another' });
      const recovered = applyCudyrMonthlySources(data, [source]).rows.filter(
        r => r.contextSource === 'eloisa_monthly_report' && r.evaluation?.category === 'C2'
      );
      expect(recovered.length).toBe(kind === 'duplicate identity' ? 2 : 1);
      expect(recovered.every(r => r.eligibility === 'por_revisar' && !r.clinicalEpisodeId)).toBe(
        true
      );
    }
  );
  it('does not infer absence when the patient has no identifiable row', () => {
    const { data, source } = make();
    source.report.patients[0].patientName = 'Another patient';
    source.report.patients[0].document = 'another-id';
    const row = applyCudyrMonthlySources(data, [source]).rows.find(
      r => r.key === data.rows[0].key
    )!;
    expect(row.cudyrStatus).toBe('sin_captura');
    expect(row.monthlyEvidence).toBeUndefined();
  });
  it('matches UTC instants by the Rapa Nui date and keeps original metadata', () => {
    const { data, source } = make();
    data.rows[0].evaluation = {
      category: 'C2',
      source: 'Eloísa',
      recordedAt: '2026-10-03T04:30:00Z',
      author: 'Profesional sintético',
      authorId: '',
      authorRole: '',
      sourceEvaluationId: 'test',
    };
    source.report.patients[0].days.forEach(d => {
      d.category = d.sourceDay === 2 ? 'C2' : null;
      d.originalValue = d.category || '';
      d.state = d.category ? 'category' : 'blank';
    });
    const row = applyCudyrMonthlySources(data, [source]).rows[0];
    expect(row.date).toBe('2026-10-02');
    expect(row.monthlyEvidence).toMatchObject({ sourceDate: '2026-10-02', state: 'found' });
    expect(row.evaluation?.author).toBe('Profesional sintético');
  });
  it('requires server verification of the workbook bytes', () => {
    const { data, source } = make();
    source.bytesVerified = false;
    expect(applyCudyrMonthlySources(data, [source]).rows[0].evaluation).toBeNull();
  });
  it('accepts a closed day even when its month is still open', () => {
    const { data, source } = make();
    data.generatedAt = '2026-10-08T20:00:00Z';
    source.importedAt = source.capture!.observedAt = '2026-10-08T19:00:00Z';
    expect(applyCudyrMonthlySources(data, [source]).rows[0].evaluation?.category).toBe('C2');
  });
  it('does not let an old manual override hide an Eloísa observation in official mode', () => {
    const input = confirmedReportInput({
      records: [reportRecord('2026-10-02', { R1: reportPatient() })],
    });
    input.records[0].beds.R1.evaluationScores = {
      cudyr: { category: 'A1', source: 'HHR · ajuste administrativo', recordedDate: '2026-10-02' },
    };
    const official = buildCudyrReport({ ...input, sourcePolicy: 'eloisa_only' });
    expect(official.rows[0].evaluation?.source).not.toBe('HHR · ajuste administrativo');
    expect(official.rows[0].evaluation?.source).not.toBe('HHR · puntuación manual');
  });
  it('uses the next morning category without inventing author, time or scores and counts it', () => {
    const { data, source } = make();
    const result = applyCudyrMonthlySources(data, [source]);
    const row = result.rows.find(r => r.date === '2026-10-02')!;
    expect(row.evaluation).toMatchObject({
      category: 'C2',
      source: 'Eloísa · informe mensual',
      author: '',
      recordedAt: '',
    });
    expect(row.evaluation?.dependencyScore).toBeUndefined();
    expect(row.monthlyEvidence?.sourceDate).toBe('2026-10-03');
    expect(cudyrReportTotals(result.rows).categorized).toBe(1);
    expect(data.rows[0].evaluation).toBeNull();
  });
  it('distinguishes a confirmed absence from an unavailable report', () => {
    const { data, source } = make();
    source.report.patients[0].days.forEach(d => {
      d.category = null;
      d.originalValue = '';
      d.state = 'blank';
    });
    expect(applyCudyrMonthlySources(data, [source]).rows[0].cudyrStatus).toBe(
      'sin_registro_observado'
    );
    expect(applyCudyrMonthlySources(data, []).rows[0].cudyrStatus).toBe('sin_captura');
  });
  it('retains a recovered patient absent from HHR without assigning a bed or eligibility', () => {
    const { data, source } = make();
    data.rows = [];
    const row = applyCudyrMonthlySources(data, [source]).rows[0];
    expect(row).toMatchObject({
      cudyrStatus: 'registrado',
      eligibility: 'por_revisar',
      clinicalEpisodeId: '',
      bedId: '',
    });
    expect(row.evaluation?.category).toBe('C2');
  });
  it('does not join a newborn by the shared maternal document', () => {
    const { data, source } = make();
    source.report.patients[0].patientName = 'RN sintético';
    const result = applyCudyrMonthlySources(data, [source]);
    expect(result.rows.find(r => r.key === data.rows[0].key)?.evaluation).toBeNull();
    expect(result.rows.find(r => r.patientName === 'RN sintético')?.evaluation?.category).toBe(
      'C2'
    );
  });
  it('does not use pre-closure or future receipts to assert absence or finality', () => {
    const { data, source } = make();
    source.capture!.observedAt = '2026-10-03T10:00:00Z';
    expect(applyCudyrMonthlySources(data, [source]).rows[0].monthlyEvidence).toBeUndefined();
  });
  it('does not count old manual scores as an Eloísa application', () => {
    const { data } = make();
    data.rows[0].evaluation = {
      category: 'C2',
      source: 'HHR · puntuación manual',
      recordedAt: '',
      sourceEvaluationId: '',
      author: '',
      authorId: '',
      authorRole: '',
    };
    data.rows[0].evaluationCapturedAt = '2026-10-03T17:00:00Z';
    const row = applyCudyrMonthlySources(data, []).rows[0];
    expect(row.evaluation).toBeNull();
    expect(row.evaluationCapturedAt).toBeUndefined();
  });
  it('preserves original timing outside the usual night window', () => {
    const { data, source } = make();
    data.rows[0].evaluation = {
      category: 'C2',
      source: 'Eloísa · Gestión de Camas',
      recordedAt: '2026-10-02T23:30:00-05:00',
      sourceEvaluationId: 'event',
      author: 'Autor',
      authorId: 'id',
      authorRole: '',
    };
    source.report.patients[0].days.forEach(d => {
      d.category = d.sourceDay === 2 ? 'C2' : null;
      d.originalValue = d.category || '';
      d.state = d.category ? 'category' : 'blank';
    });
    const row = applyCudyrMonthlySources(data, [source]).rows[0];
    expect(row.evaluation?.recordedAt).toBe('2026-10-02T23:30:00-05:00');
    expect(row.monthlyEvidence?.sourceDate).toBe('2026-10-02');
  });
});
