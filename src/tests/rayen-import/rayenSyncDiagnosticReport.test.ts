// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildRayenSyncDiagnosticReport } from '@/features/rayen-import/domain/rayenSyncDiagnosticReport';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import { RayenSyncEventSchema } from '@/schemas/zod/dailyRecord';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import { asStoredDailyRecordShape } from '@/tests/factories/DataFactory';

const event: RayenSyncEvent = {
  id: 'run-test',
  sourceDate: '2026-10-17',
  startedAt: '2026-10-18T15:00:00Z',
  by: 'Operador',
  status: 'partial',
  structuralReview: {
    structureConfirmed: true,
    isolatedConflicts: 1,
    historicalCorrectionsPending: false,
    historicalCorrectionsRequireFreshCapture: false,
    issues: [
      {
        bedId: null,
        reason: 'historical-reconstruction',
        diagnostic: {
          patientName: 'Paciente sintético',
          document: 'PAS-TEST',
          bedId: 'C-R3',
          censusDate: '2026-10-17',
          detail: 'El informe no identifica el episodio.',
          source: 'gestion-camas/egresos',
          sourceTimestamp: '18-10-2026 00:19',
          sourceClinicalDay: '2026-10-17',
        },
      },
    ],
  },
};

describe('explicit clinical diagnostic export', () => {
  it('persists and exports network failure independently of initial readiness', () => {
    const parsed = RayenSyncEventSchema.parse({
      ...event,
      status: 'failed',
      failureReason: 'snapshot_network_error',
    });
    const report = buildRayenSyncDiagnosticReport([parsed]);
    expect(report.attempts[0].failureReason).toBe('snapshot_network_error');
    expect(report.interpretation).toContain('source describe las conexiones al iniciar');
  });
  it('preserves case evidence through persistence and exports it without arbitrary payloads', () => {
    const parsed = RayenSyncEventSchema.parse(event);
    const report = buildRayenSyncDiagnosticReport([
      { ...parsed, rawPayload: 'SECRET' } as RayenSyncEvent,
    ]);
    expect(report.attempts[0].issues[0]).toMatchObject({
      patientName: 'Paciente sintético',
      document: 'PAS-TEST',
      bedId: 'C-R3',
      clinicalEpisodeId: null,
      sourceClinicalDay: '2026-10-17',
      detail: 'El informe no identifica el episodio.',
      code: 'HHR-SYNC-1/census/historical-reconstruction',
    });
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });
  it('does not invent missing identities in legacy issues', () => {
    const legacy = {
      ...event,
      structuralReview: {
        ...event.structuralReview!,
        issues: [{ bedId: 'R3', reason: 'unclassified' as const }],
      },
    };
    expect(buildRayenSyncDiagnosticReport([legacy]).attempts[0].issues[0]).toMatchObject({
      patientName: null,
      document: null,
    });
  });
  it('uses exact episode identity, never the new occupant or the mother sharing a document', () => {
    const record = asStoredDailyRecordShape({
      date: '2026-10-17',
      beds: {
        R3: {
          patientName: 'Madre',
          rut: 'TEST',
          clinicalEpisodeId: 'mother',
          clinicalCrib: { patientName: 'RN', rut: 'TEST', clinicalEpisodeId: 'child' },
        },
      },
    });
    const errors = [
      {
        bedId: 'R3',
        clinicalEpisodeId: 'child',
        source: 'patch' as const,
        reason: 'write_failed' as const,
        message: 'RAW_SECRET',
      },
    ];
    expect(buildRayenSyncCoverage(2, errors, '', record).issues?.[0].diagnostic?.patientName).toBe(
      'RN'
    );
    const both = buildRayenSyncCoverage(
      2,
      [...errors, { ...errors[0], clinicalEpisodeId: 'mother' }],
      '',
      record
    );
    expect(both.issues?.map(issue => issue.diagnostic?.patientName)).toEqual(['RN', 'Madre']);
    expect(both).toMatchObject({ completed: 0, errors: 2 });

    const missing = buildRayenSyncCoverage(
      2,
      [{ ...errors[0], clinicalEpisodeId: 'previous' }],
      '',
      record
    );
    expect(missing.issues?.[0].diagnostic?.patientName).toBeUndefined();
    expect(JSON.stringify(missing)).not.toContain('RAW_SECRET');
  });

  it('exports clinical cudyrRecovery details, cause and resolved bed for wildcard episode issues', () => {
    const record = asStoredDailyRecordShape({
      date: '2026-10-27',
      beds: {
        H5C2: {
          patientName: 'Paciente Sintética',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'synthetic-ep-1',
        },
      },
    });
    const coverage = buildRayenSyncCoverage(
      1,
      [
        {
          bedId: '*',
          clinicalEpisodeId: 'synthetic-ep-1',
          source: 'cudyr',
          reason: 'source_unavailable',
          cause: 'invalid_response',
          cudyrRecovery: { kind: 'attribution_unreliable', targetDate: '2026-10-26' },
          message: 'attribution_unreliable',
        },
      ],
      '2026-10-27T22:03:00Z',
      record
    );
    const report = buildRayenSyncDiagnosticReport([
      {
        ...event,
        sourceDate: '2026-10-27',
        structuralReview: undefined,
        coverage,
      },
    ]);
    expect(report.attempts[0].issues[0]).toMatchObject({
      stage: 'clinical',
      code: 'HHR-SYNC-1/cudyr/source_unavailable',
      cause: 'invalid_response',
      cudyrRecovery: { kind: 'attribution_unreliable', targetDate: '2026-10-26' },
      bedId: 'H5C2',
      clinicalEpisodeId: 'synthetic-ep-1',
      patientName: 'Paciente Sintética',
      sourceClinicalDay: '2026-10-26',
      detail: 'attribution_unreliable',
    });
  });
});
