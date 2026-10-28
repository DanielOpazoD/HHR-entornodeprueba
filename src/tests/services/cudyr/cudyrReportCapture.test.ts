import { describe, expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { reportInput, reportRecord, reportCapture, reportObservation } from './reportFixtures';
import { cudyrControlStatus } from '@/services/cudyr/cudyrDailyControl';

describe('CUDYR source result and capture coverage', () => {
  it('distinguishes empty observation, unavailable source, incomplete capture and local pending', () => {
    const record = reportRecord();
    record.beds.R1.cudyr = undefined;
    const capture = reportCapture();
    expect(buildCudyrReport(reportInput({ records: [record] })).rows[0].cudyrStatus).toBe(
      'sin_captura'
    );
    for (const [change, expected] of [
      [{ status: 'observed' }, 'sin_registro_observado'],
      [{ status: 'not_observed' }, 'sin_captura'],
      [{ status: 'unavailable' }, 'fuente_no_disponible'],
      [{ totalParts: 2 }, 'captura_incompleta'],
    ] as const) {
      const result = buildCudyrReport(
        reportInput({
          records: [record],
          captures: [{ ...capture, capture: { ...capture.capture, ...change } }],
        })
      );
      expect(result.rows[0].cudyrStatus).toBe(expected);
    }
    const pending = buildCudyrReport(
      reportInput({
        observations: [reportObservation()],
        pending: [{ clinicalEpisodeId: 'synthetic-episode', dates: ['2026-10-02'] }],
      })
    );
    expect(pending.rows[0].cudyrStatus).toBe('guardado_pendiente');
    expect(cudyrReportTotals(pending.rows).categorized).toBe(0);
  });

  it('shows verification pending for an unobserved discharged episode, not a missing application', () => {
    const record = reportRecord();
    record.beds.R1.cudyr = undefined;
    const receipt = reportCapture();
    receipt.observationIds = [];
    receipt.capture = { ...receipt.capture, status: 'not_observed', totalEvaluations: 0 };
    const row = buildCudyrReport(reportInput({ records: [record], captures: [receipt] })).rows[0];

    expect(row.evaluation).toBeNull();
    expect(cudyrControlStatus(row)).toBe('Verificación pendiente');
    expect(row.warnings.join(' ')).toContain('no fue observado');
  });

  it('does not promote a legacy manual score when the episode could not be observed', () => {
    const receipt = reportCapture();
    receipt.capture = { ...receipt.capture, status: 'not_observed' };
    const data = buildCudyrReport(reportInput({ captures: [receipt] }));
    expect(data.rows[0].cudyrStatus).toBe('sin_captura');
    expect(cudyrReportTotals(data.rows).categorized).toBe(0);
  });

  it('keeps equally timed observed and unobserved captures inconclusive in either receipt order', () => {
    const record = reportRecord();
    record.beds.R1.cudyr = undefined;
    const observed = reportCapture();
    const missing = reportCapture({
      id: 'missing-receipt',
      capture: { ...observed.capture, id: 'missing-capture', status: 'not_observed' },
    });
    for (const captures of [
      [observed, missing],
      [missing, observed],
    ]) {
      const row = buildCudyrReport(reportInput({ records: [record], captures })).rows[0];
      expect(cudyrControlStatus(row)).toBe('Verificación pendiente');
    }
  });
  it('retains confirmed results when a later capture fails without changing clinical evidence', () => {
    for (const patch of [
      { totalParts: 2 },
      { status: 'unavailable' as const },
      { status: 'legacy_extension' as const },
      { status: 'not_observed' as const },
    ]) {
      const capture = reportCapture();
      const data = buildCudyrReport(
        reportInput({
          observations: [reportObservation()],
          captures: [{ ...capture, capture: { ...capture.capture, ...patch } }],
        })
      );
      const row = data.rows[0];
      expect(row.evaluation?.category).toBe('C2');
      expect(row.cudyrStatus).toBe('registrado');
      expect(row.warnings).toContain(
        'Resultado de Eloísa disponible; la última consulta no pudo completarse.'
      );
      expect(cudyrReportTotals([row]).categorized).toBe(1);
      expect(cudyrReportTotals([row]).withoutConfirmedResult).toBe(0);
    }
  });
  it('does not promote legacy local scores when the source capture is inconclusive', () => {
    const capture = reportCapture();
    const data = buildCudyrReport(
      reportInput({
        captures: [
          { ...capture, observationIds: [], capture: { ...capture.capture, totalParts: 2 } },
        ],
      })
    );
    expect(data.rows[0].evaluation?.source).toBe('HHR · puntuación manual');
    expect(data.rows[0].cudyrStatus).toBe('captura_incompleta');
    expect(cudyrReportTotals(data.rows).categorized).toBe(0);
  });
  it('counts a persisted Eloísa result from a partial capture without inventing missing results', () => {
    const capture = reportCapture();
    const observation = reportObservation({
      firstCapturedAt: capture.receivedAt,
      lastVerifiedAt: capture.receivedAt,
    });
    observation.evaluation.author = undefined;
    observation.evaluation.authorId = undefined;
    const record = reportRecord();
    record.beds.R1.cudyr = undefined;
    const input = reportInput({
      records: [record],
      observations: [observation],
      captures: [
        { ...capture, capture: { ...capture.capture, totalParts: 2, metadataStatus: 'partial' } },
      ],
    });
    const data = buildCudyrReport(input);
    expect(data.rows[0].cudyrStatus).toBe('registrado');
    expect(cudyrReportTotals(data.rows).categorized).toBe(1);
    const withoutResult = buildCudyrReport({ ...input, observations: [] });
    expect(withoutResult.rows[0].cudyrStatus).toBe('captura_incompleta');
    expect(cudyrReportTotals(withoutResult.rows).categorized).toBe(0);
  });
  it('resolves all equally timed captures conservatively independent of receipt order', () => {
    const complete = reportCapture();
    for (const patch of [
      { totalParts: 2 },
      { status: 'unavailable' as const },
      { status: 'not_observed' as const },
    ]) {
      const other = {
        ...complete,
        id: 'other-receipt',
        capture: { ...complete.capture, id: 'other-capture', ...patch },
      };
      const rows = [
        [complete, other],
        [other, complete],
      ].map(
        captures =>
          buildCudyrReport(reportInput({ observations: [reportObservation()], captures })).rows[0]
      );
      expect(rows[0].cudyrStatus).toBe(rows[1].cudyrStatus);
      expect(rows[0].captureId).toBe('other-capture');
      expect(rows[1].captureId).toBe('other-capture');
      expect(cudyrReportTotals(rows).categorized).toBe(2);
    }
  });
});
