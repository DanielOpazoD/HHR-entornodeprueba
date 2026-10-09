import { describe, expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import {
  reportInput,
  reportRecord,
  reportPatient,
  reportObservation,
  reportCapture,
  reportPlacement,
} from './reportFixtures';

describe('CUDYR independent temporal evidence', () => {
  it('preserves the known original evaluation instant across result and author conflicts', () => {
    const original = reportObservation();
    original.evaluation.recordedAt = '2026-10-02T22:00:00-05:00';
    const capture = reportCapture();
    capture.capture.sourcePlacements = [
      reportPlacement({ sourceEndAt: '2026-10-03T00:00:00-05:00' }),
      reportPlacement({
        sourceMappingId: 'crib',
        bedId: 'NEO1',
        modality: 'cuna',
        sourceStartAt: '2026-10-03T00:00:00-05:00',
      }),
    ];
    for (const other of [
      {
        ...original,
        id: 'another-event',
        eventKey: 'another-event',
        evaluation: {
          ...original.evaluation,
          sourceEvaluationId: 'another-event',
          author: 'Otra autora',
        },
      },
      { ...original, id: 'other-version', evaluation: { ...original.evaluation, category: 'B1' } },
    ]) {
      const row = buildCudyrReport(
        reportInput({ observations: [original, other], captures: [capture] })
      ).rows[0];
      expect(Date.parse(row.referenceAt)).toBe(Date.parse(original.evaluation.recordedAt));
      expect(row).toMatchObject({
        group: 'intermedia',
        modality: 'hospitalizacion',
        eligibility: 'por_revisar',
        cudyrStatus: 'por_revisar',
      });
      // Bed context belongs to the evaluation; the eight-hour stay belongs to the 01:00 cutoff.
      // This episode moved to a crib before that cutoff, so the earlier evaluation cannot prove a hospital stay.
      expect(cudyrReportTotals([row])).toMatchObject({ eligible: 0, categorized: 0, review: 1 });
    }
  });
  it('does not choose between contradictory admission times around the eight-hour cutoff', () => {
    for (const times of [
      ['16:00', '20:00'],
      ['20:00', '16:00'],
    ]) {
      const record = reportRecord();
      record.beds.R1.admissionDate = record.date;
      record.beds.R1.admissionTime = times[0];
      record.discharges = [
        {
          id: 'later-departure',
          clinicalEpisodeId: 'synthetic-episode',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'irrelevant',
          patientName: 'Paciente Sintético',
          rut: 'synthetic-rut',
          diagnosis: 'Sintético',
          time: '10:00',
          movementDate: '2026-10-04',
          status: 'Vivo',
          originalData: reportPatient({ admissionDate: record.date, admissionTime: times[1] }),
        },
      ];
      const row = buildCudyrReport(reportInput({ records: [record] })).rows[0];
      expect(row.eligibility).toBe('por_revisar');
      expect(cudyrReportTotals([row])).toMatchObject({ eligible: 0, review: 1 });
    }
  });
});
