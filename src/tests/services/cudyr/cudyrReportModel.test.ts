import { describe, expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import {
  filterCudyrReportRows,
  EMPTY_CUDYR_REPORT_FILTERS,
} from '@/services/cudyr/cudyrReportPresentation';
import {
  reportInput,
  reportPatient,
  reportRecord,
  reportCapture,
  reportObservation,
  reportPlacement,
} from './reportFixtures';

describe('CUDYR canonical report', () => {
  it('keeps media/intermedia independent of UPC and retains excluded crib and CMA rows', () => {
    const p = reportPatient;
    const record = reportRecord('2026-10-02', {
      R1: p(),
      NEO1: p({ clinicalEpisodeId: 'neo', bedId: 'NEO1' }),
      H1C1: p({ clinicalEpisodeId: 'crib', bedId: 'H1C1', bedMode: 'Cuna' }),
      CMA1: p({ clinicalEpisodeId: 'cma', bedId: 'CMA1', location: 'CMA recuperación' }),
    });
    const data = buildCudyrReport(reportInput({ records: [record] }));
    expect(data.rows.find(row => row.bedId === 'R1')?.group).toBe('intermedia');
    expect(data.rows.find(row => row.bedId === 'NEO1')?.group).toBe('media');
    expect(cudyrReportTotals(data.rows)).toMatchObject({
      eligible: 2,
      categorized: 2,
      excluded: 2,
      review: 0,
      categories: { D3: { media: 1, intermedia: 1 } },
    });
    expect(data.rows.every(row => row.rut && row.diagnosis)).toBe(true);
  });
  it('does not merge episodes sharing a RUT or unidentified legacy rows', () => {
    const data = buildCudyrReport(
      reportInput({
        records: [
          reportRecord('2026-10-02', {
            R1: reportPatient(),
            R2: reportPatient({ clinicalEpisodeId: 'other-episode', bedId: 'R2' }),
            R3: reportPatient({ clinicalEpisodeId: undefined, bedId: 'R3' }),
            R4: reportPatient({ clinicalEpisodeId: undefined, bedId: 'R4' }),
          }),
        ],
      })
    );
    expect(data.rows).toHaveLength(4);
    expect(new Set(data.rows.map(row => row.key)).size).toBe(4);
  });
  it('retains unidentified archive versions without manufacturing patient-day rows', () => {
    const observation = reportObservation();
    observation.evaluation.clinicalEpisodeId = '';
    observation.captureContexts = ['R1', 'R2'].map(bedId => ({
      clinicalEpisodeId: '',
      section: 'census',
      bedId,
      patientName: 'Legado ' + bedId,
      admissionDate: '2026-09-20',
    }));
    const data = buildCudyrReport(
      reportInput({
        records: [],
        observations: [observation, { ...observation, id: 'another-version' }],
      })
    );
    expect(data.rows).toHaveLength(0);
    expect(data.observations).toHaveLength(2);
    expect(data.issues.join(' ')).toContain('episodio ausente');
  });
  it('rejects a conflicting third application tied at the latest time and unorderable timestamps', () => {
    const original = reportObservation();
    const copy = (id: string, category: string, recordedAt = original.evaluation.recordedAt) =>
      reportObservation({
        id,
        eventKey: id,
        evaluation: { ...original.evaluation, sourceEvaluationId: id, category, recordedAt },
      });
    for (const observations of [
      [original, copy('same', 'C2'), copy('different', 'B1')],
      [original, copy('unknown-time', 'C2', 'invalid')],
    ]) {
      const row = buildCudyrReport(reportInput({ observations })).rows[0];
      expect(row.evaluation).toBeNull();
      expect(row.eligibility).toBe('elegible');
      expect(cudyrReportTotals([row])).toMatchObject({
        eligible: 1,
        categorized: 0,
        withoutConfirmedResult: 1,
      });
    }
  });
  it('does not arbitrarily select an author from distinct same-time applications or role-label conflicts', () => {
    const original = reportObservation();
    for (const other of [
      reportObservation({
        id: 'same-time',
        eventKey: 'another-event',
        evaluation: {
          ...original.evaluation,
          sourceEvaluationId: 'another-event',
          author: 'Otra autora',
        },
      }),
      reportObservation({
        id: 'role-change',
        evaluation: { ...original.evaluation, authorRole: 'Médico' },
      }),
    ]) {
      const row = buildCudyrReport(reportInput({ observations: [original, other] })).rows[0];
      expect(row.evaluation).toBeNull();
      expect(row.cudyrStatus).toBe('por_revisar');
      expect(cudyrReportTotals([row])).toMatchObject({
        eligible: 1,
        categorized: 0,
        withoutConfirmedResult: 1,
      });
    }
  });
  it('reconciles an HHR external transfer as departure while internal bed changes stay in placement context', () => {
    const record = reportRecord();
    record.transfers = [
      {
        id: 'external',
        clinicalEpisodeId: 'synthetic-episode',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'irrelevant',
        patientName: 'Paciente Sintético',
        rut: 'synthetic-rut',
        diagnosis: 'Sintético',
        time: '18:00',
        movementDate: '2026-10-02',
        receivingCenter: 'Centro receptor sintético',
        evacuationMethod: 'Avión',
        originalData: reportPatient(),
      },
    ];
    const row = buildCudyrReport(reportInput({ records: [record] })).rows[0];
    expect(row.eligibility).toBe('no_elegible');
    expect(row.movements[0].section).toBe('transfers');
  });
  it('counts versions and multiple applications once, preserving source author separately from the synchronizer', () => {
    const observation = reportObservation();
    const older = reportObservation({
      id: 'old',
      eventKey: 'old',
      evaluation: {
        ...observation.evaluation,
        sourceEvaluationId: 'old',
        recordedAt: '2026-10-02T20:00:00-05:00',
      },
    });
    const data = buildCudyrReport(
      reportInput({
        observations: [observation, { ...observation, id: 'metadata' }, older],
        captures: [reportCapture()],
      })
    );
    const row = data.rows.find(row => row.date === '2026-10-02')!;
    expect(row).toMatchObject({
      evaluationCount: 2,
      captureActor: 'sync@example.com',
      evaluation: {
        author: 'Autora Sintética',
        recordedAt: '2026-10-03T03:00:00-05:00',
        category: 'C2',
      },
    });
    expect(cudyrReportTotals([row]).categorized).toBe(1);
  });
  it('links next-day capture provenance to the clinical day and preserves archive epicrisis', () => {
    const observation = reportObservation();
    observation.captureContexts[0].medicalEpicrisisStatus = 'completed';
    const capture = reportCapture({ censusDate: '2026-10-03' });
    const data = buildCudyrReport(
      reportInput({ records: [], observations: [observation], captures: [capture] })
    );
    expect(data.rows.find(row => row.date === '2026-10-02')).toMatchObject({
      captureActor: 'sync@example.com',
      lastCaptureAt: capture.capture.observedAt,
      lastPersistedAt: capture.receivedAt,
      medicalEpicrisisStatus: 'completed',
    });
    const fallback = buildCudyrReport(reportInput({ observations: [observation] })).rows[0];
    expect(fallback.lastCaptureAt).toBe('');
    expect(fallback.lastPersistedAt).toBe(observation.firstCapturedAt);
  });
  it('keeps certain crib exclusion when an egreso has an unknown time', () => {
    const record = reportRecord('2026-10-02', { R1: reportPatient({ bedMode: 'Cuna' }) });
    record.discharges = [
      {
        id: 'out',
        clinicalEpisodeId: 'synthetic-episode',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'irrelevant',
        patientName: 'Paciente Sintético',
        rut: 'synthetic-rut',
        diagnosis: 'Sintético',
        time: '',
        movementDate: '2026-10-03',
        status: 'Vivo',
        originalData: reportPatient({ bedMode: 'Cuna' }),
      },
    ];
    expect(buildCudyrReport(reportInput({ records: [record] })).rows[0].eligibility).toBe(
      'no_elegible'
    );
  });
  it('does not let an old daily projection resurrect an annulled or conflicting source application', () => {
    const original = reportObservation();
    for (const evaluation of [
      { ...original.evaluation, isDeleted: true },
      { ...original.evaluation, category: 'B1' },
    ]) {
      const row = buildCudyrReport(
        reportInput({ observations: [original, { ...original, id: 'revision', evaluation }] })
      ).rows[0];
      expect(row.evaluation).toBeNull();
      expect(row.evaluationCount).toBe(1);
      expect(cudyrReportTotals([row]).categorized).toBe(0);
    }
  });
  it('retains admin removal over an older source category', () => {
    const record = reportRecord();
    record.beds.R1.evaluationScores = {
      cudyr: { category: '', source: 'HHR · ajuste administrativo', recordedDate: record.date },
    };
    const row = buildCudyrReport(
      reportInput({ records: [record], observations: [reportObservation()] })
    ).rows[0];
    expect(row.evaluation).toBeNull();
    expect(row.evaluationCount).toBe(1);
  });
  it('keeps all observed event counts when an administrative adjustment takes precedence', () => {
    const original = reportObservation();
    const observations = [
      original,
      { ...original, id: 'revision', evaluation: { ...original.evaluation, category: 'B1' } },
      {
        ...original,
        id: 'deleted-event',
        eventKey: 'deleted-event',
        evaluation: {
          ...original.evaluation,
          sourceEvaluationId: 'deleted-event',
          isDeleted: true,
        },
      },
    ];
    for (const category of ['', 'A1']) {
      const record = reportRecord();
      record.beds.R1.evaluationScores = {
        cudyr: { category, source: 'HHR · ajuste administrativo', recordedDate: record.date },
      };
      const row = buildCudyrReport(reportInput({ records: [record], observations })).rows[0];
      expect(row.evaluationCount).toBe(2);
      expect(row.evaluation?.category || '').toBe(category);
    }
  });
  it('uses later-captured intervals without reclassifying earlier crib days as current media beds', () => {
    const capture = reportCapture();
    capture.censusDate = '2026-10-04';
    capture.capture.sourcePlacements = [
      reportPlacement({
        sourceMappingId: 'crib',
        bedId: 'H1C1',
        modality: 'cuna',
        sourceStartAt: '2026-10-01T10:00:00-05:00',
        sourceEndAt: '2026-10-03T15:00:00-05:00',
      }),
      reportPlacement({
        sourceMappingId: 'media',
        bedId: 'NEO1',
        modality: 'hospitalizacion',
        sourceStartAt: '2026-10-03T15:00:00-05:00',
      }),
    ];
    capture.capture.observedAt = '2026-10-05T15:00:00-05:00';
    const data = buildCudyrReport(
      reportInput({
        records: ['01', '02', '03', '04'].map(day =>
          reportRecord('2026-10-' + day, { NEO1: reportPatient({ bedId: 'NEO1' }) })
        ),
        captures: [capture],
      })
    );
    expect(data.rows.map(row => row.eligibility)).toEqual([
      'no_elegible',
      'no_elegible',
      'por_revisar',
      'elegible',
    ]);
    expect(data.rows[3].group).toBe('media');
  });
  it('does not use identity captured later as evidence of that earlier bed', () => {
    const data = buildCudyrReport(
      reportInput({ records: [], observations: [reportObservation()] })
    );
    expect(data.rows[0]).toMatchObject({
      eligibility: 'por_revisar',
      identitySourceDate: '2026-10-03',
      bedId: '',
    });
  });
  it('keeps a distinct undated egreso unresolved even when another egreso has a date', () => {
    const record = reportRecord();
    const movement = {
      id: 'dated',
      clinicalEpisodeId: 'synthetic-episode',
      bedId: 'R1',
      bedName: 'R1',
      bedType: 'irrelevant',
      patientName: 'Paciente Sintético',
      rut: 'synthetic-rut',
      diagnosis: 'Sintético',
      time: '18:00',
      movementDate: '2026-10-02',
      status: 'Vivo' as const,
      originalData: reportPatient(),
    };
    record.discharges = [movement, { ...movement, id: 'undated', movementDate: '' }];
    const row = buildCudyrReport(reportInput({ records: [record] })).rows[0];
    expect(row.eligibility).toBe('por_revisar');
    expect(row.eligibilityReason).toContain('sin fecha');
  });
  it('uses actual departure without overwriting the system egreso and flags unknown time on the cutoff day', () => {
    const record = reportRecord();
    record.discharges = [
      {
        id: 'departure',
        clinicalEpisodeId: 'synthetic-episode',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'irrelevant',
        patientName: 'Paciente Sintético',
        rut: 'synthetic-rut',
        diagnosis: 'Diagnóstico sintético',
        time: '10:00',
        movementDate: '2026-10-04',
        status: 'Vivo',
        originalData: reportPatient(),
      },
    ];
    const correction = {
      schemaVersion: 1 as const,
      clinicalEpisodeId: 'synthetic-episode',
      revision: 1,
      operationId: 'op',
      actualDischarge: { date: '2026-10-02', time: '20:00', timeZone: 'Pacific/Easter' as const },
      reason: 'Verificación sintética',
      authorityDate: record.date,
      admissionDate: '2026-09-20',
      sourceContexts: [],
      updatedAt: '2026-10-05T12:00:00Z',
      updatedBy: {
        uid: 'user',
        email: 'test@example.com',
        name: 'Usuario sintético',
        role: 'admin',
      },
    };
    const row = buildCudyrReport(reportInput({ records: [record], corrections: [correction] }))
      .rows[0];
    expect(row.eligibility).toBe('no_elegible');
    expect(row.movements[0].date).toBe('2026-10-04');
    const unknown = buildCudyrReport(
      reportInput({
        records: [record],
        corrections: [
          { ...correction, actualDischarge: { date: '2026-10-03', timeZone: 'Pacific/Easter' } },
        ],
      })
    ).rows[0];
    expect(unknown.eligibility).toBe('por_revisar');
  });
  it('uses the same totals after filtering accented names, punctuated RUT and statistical group', () => {
    const data = buildCudyrReport(
      reportInput({
        records: [
          reportRecord('2026-10-02', {
            R1: reportPatient({ rut: '12.345.678-9' }),
            NEO2: reportPatient({ clinicalEpisodeId: 'second', bedId: 'NEO2' }),
          }),
        ],
      })
    );
    const rows = filterCudyrReportRows(data.rows, {
      ...EMPTY_CUDYR_REPORT_FILTERS,
      search: '123456789',
      group: 'intermedia',
    });
    expect(cudyrReportTotals(rows)).toMatchObject({ rows: 1, eligible: 1, categorized: 1 });
    expect(
      filterCudyrReportRows(data.rows, { ...EMPTY_CUDYR_REPORT_FILTERS, search: 'sintetico' })
    ).toHaveLength(2);
  });
});
