import { describe, expect, it } from 'vitest';
import { cudyrArchiveCoverage } from '@/services/cudyr/cudyrArchiveCoverage';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import {
  reportInput,
  reportCapture,
  reportObservation,
  reportPatient,
  reportRecord,
} from './reportFixtures';
const now = new Date('2026-10-04T18:00:00Z');
const fixture = () =>
  buildCudyrReport(
    reportInput({
      from: '2026-10-02',
      to: '2026-10-02',
      records: [reportRecord()],
      observations: [reportObservation()],
      captures: [reportCapture()],
      coverage: [
        {
          date: '2026-10-02',
          state: 'disponible',
          lastSyncedAt: '2026-10-04T15:00:00Z',
          runId: 'run',
        },
      ],
    })
  );
describe('archival coverage independently of compliance', () => {
  it('requires all parts, complete metadata and a post-close persisted capture', () => {
    const data = fixture();
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('complete');
    data.captures[0].capture.totalParts = 2;
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('pending');
    data.captures[0].capture.totalParts = 1;
    data.captures[0].capture.metadataStatus = 'partial';
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('pending');
    data.captures[0].capture.metadataStatus = 'complete';
    data.captures[0].capture.observedAt = '2026-10-03T11:59:59-05:00';
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('pending');
  });
  it('does not require a post-close census sync, and separates eligibility from capture verification', () => {
    const data = fixture();
    data.coverage[0].lastSyncedAt = '';
    data.rows[0].eligibility = 'por_revisar';
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('complete');
  });
  it('requires the server receipt to confirm persistence after close too', () => {
    const data = fixture();
    data.captures[0].receivedAt = '2026-10-03T11:59:59-05:00';
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('pending');
  });
  it('keeps the last editable second open and closes at noon in Rapa Nui', () => {
    expect(cudyrArchiveCoverage(fixture(), new Date('2026-10-03T11:59:59-05:00'))[0].state).toBe(
      'open'
    );
    const data = fixture();
    const closed = '2026-10-03T12:00:00-05:00';
    expect(cudyrArchiveCoverage(data, new Date(closed))[0].state).toBe('pending');
    data.coverage[0].lastSyncedAt = '2026-10-02T20:00:00Z';
    data.captures[0].capture.observedAt = closed;
    data.captures[0].receivedAt = closed;
    expect(cudyrArchiveCoverage(data, new Date(closed))[0].state).toBe('complete');
  });
  it('does not equate a visible legacy result, pending write or missing census with complete archive', () => {
    const data = fixture();
    data.captures = [];
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('pending');
    const pending = fixture();
    pending.rows[0].cudyrStatus = 'guardado_pendiente';
    expect(cudyrArchiveCoverage(pending, now)[0].state).toBe('pending');
    pending.coverage = [];
    expect(cudyrArchiveCoverage(pending, now)[0].reason).toContain('Sin censo');
  });
  it('accepts a complete negative query without manufacturing compliance', () => {
    const data = fixture();
    data.rows[0].evaluation = null;
    data.rows[0].cudyrStatus = 'sin_registro_observado';
    data.captures[0].capture.totalEvaluations = 0;
    data.captures[0].observationIds = [];
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('complete');
    data.captures[0].capture.status = 'not_observed';
    expect(cudyrArchiveCoverage(data, now)[0].state).toBe('pending');
  });
  it('keeps missing days in the denominator and does not require a CUDYR for excluded cribs', () => {
    const data = fixture();
    data.from = '2026-10-01';
    expect(cudyrArchiveCoverage(data, now).map(day => day.state)).toEqual(['pending', 'complete']);
    const crib = buildCudyrReport(
      reportInput({
        ...data,
        records: [reportRecord('2026-10-02', { H1C1: reportPatient({ bedMode: 'Cuna' }) })],
      })
    );
    expect(cudyrArchiveCoverage(crib, now)[1].state).toBe('complete');
  });
});
