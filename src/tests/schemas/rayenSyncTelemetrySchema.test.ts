import { describe, expect, it } from 'vitest';
import { DailyRecordSchema } from '@/schemas/zodSchemas';

describe('Eloísa sync telemetry schema', () => {
  it('preserves compatible aggregate history and strips identifying fields', () => {
    const record = DailyRecordSchema.parse({
      date: '2026-07-14',
      rayenSync: {
        at: '2026-07-14T10:00:00.000Z',
        by: 'Operador HHR',
        runId: 'run-1',
        status: 'complete',
        coverage: {
          total: 2,
          completed: 2,
          errors: 0,
          sourceErrors: 0,
          issues: [{ bedId: 'R2', source: 'patch', reason: 'concurrent_write' }],
          completedAt: '2026-07-14T10:03:00.000Z',
        },
        staffingObservation: {
          ambiguousSections: ['nurse_night'],
          ignoredBoundaryRecords: 2,
        },
      },
      rayenSyncHistory: [
        {
          id: 'run-1',
          startedAt: '2026-07-14T10:00:00.000Z',
          completedAt: '2026-07-14T10:03:00.000Z',
          by: 'Operador HHR',
          status: 'complete',
          changes: { admissions: 0, updates: 1, moves: 0, discharges: 0, unchanged: 1 },
          structuralReview: {
            structureConfirmed: true,
            historicalCorrectionsPending: false,
            historicalCorrectionsRequireFreshCapture: false,
            isolatedConflicts: 0,
          },
          performance: {
            stagesMs: { preflight: 120, dualCapture: 900, clinicalReads: 2_500 },
            counters: { requests: 8, cacheHits: 2, patches: 1, retries: 0, timeouts: 0 },
            sourceQuality: {
              treatingPhysicians: {
                encounters: 2,
                catalogEntries: 3,
                assignedEncounters: 2,
                sourceResolvedNames: 1,
                plannedResolvedNames: 2,
                physicianName: 'No persistible',
              },
            },
            rut: '11.111.111-1',
            patientName: 'Paciente no persistible',
          },
        },
      ],
    });

    expect(record.rayenSync?.coverage?.completed).toBe(2);
    expect(record.rayenSync?.coverage?.issues?.[0]).toMatchObject({
      bedId: 'R2',
      reason: 'concurrent_write',
    });
    expect(record.rayenSync?.staffingObservation).toEqual({
      ambiguousSections: ['nurse_night'],
      ignoredBoundaryRecords: 2,
    });
    expect(record.rayenSyncHistory?.[0]).toMatchObject({ id: 'run-1', status: 'complete' });
    expect(record.rayenSyncHistory?.[0].structuralReview).toEqual({
      structureConfirmed: true,
      historicalCorrectionsPending: false,
      historicalCorrectionsRequireFreshCapture: false,
      isolatedConflicts: 0,
    });
    expect(record.rayenSyncHistory?.[0].performance).toEqual({
      stagesMs: { preflight: 120, dualCapture: 900, clinicalReads: 2_500 },
      counters: { requests: 8, cacheHits: 2, patches: 1, retries: 0, timeouts: 0 },
      sourceQuality: {
        treatingPhysicians: {
          encounters: 2,
          catalogEntries: 3,
          assignedEncounters: 2,
          sourceResolvedNames: 1,
          plannedResolvedNames: 2,
        },
      },
    });
    expect(JSON.stringify(record.rayenSyncHistory?.[0].performance)).not.toContain(
      'Paciente no persistible'
    );
    expect(JSON.stringify(record.rayenSyncHistory?.[0].performance)).not.toContain(
      'No persistible'
    );
  });
});
