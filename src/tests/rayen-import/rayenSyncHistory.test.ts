import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  MAX_RAYEN_SYNC_HISTORY,
  buildAppliedRayenSyncEvent,
  buildFailedRayenSyncEvent,
  buildRayenSyncCoverage,
  buildRayenStaffingObservation,
  completeRayenSyncEvent,
  rayenSyncMetaFromEvent,
  upsertRayenSyncEvent,
  type RayenSyncRun,
} from '@/features/rayen-import/domain/rayenSyncHistory';
import { mergeRayenSyncPerformance } from '@/features/rayen-import/domain/rayenSyncPerformance';

const run = (id = 'run-1', startedAt = '2026-07-14T10:00:00.000Z'): RayenSyncRun => ({
  id,
  sourceDate: '2026-07-14',
  startedAt,
  by: 'Operador HHR',
  source: {
    extensionVersion: '0.5.0',
    protocolVersion: 1,
    fichaMedico: 'ready',
    gestionCamas: 'ready',
  },
  policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 3 },
});

const diff = (changes = 1): CensusImportDiff =>
  ({
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    unchangedCount: 3,
    summary: {
      admissions: changes,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 3,
    },
  }) as CensusImportDiff;

describe('rayen sync history', () => {
  it('creates the first aggregate-only applied event and its legacy projection', () => {
    const performance = {
      stagesMs: { preflight: 120, dualCapture: 850 },
      counters: { requests: 2, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
    };
    const event = buildAppliedRayenSyncEvent(
      { ...run(), performance },
      diff(),
      '2026-07-14T10:01:00.000Z'
    );
    const history = upsertRayenSyncEvent(undefined, event);

    expect(history).toEqual([event]);
    expect(rayenSyncMetaFromEvent(event)).toMatchObject({
      at: run().startedAt,
      by: 'Operador HHR',
      runId: 'run-1',
      status: 'applied',
    });
    expect(event.performance).toEqual(performance);
    expect(event.policy).toEqual({
      mode: 'preview',
      clinicalBatchMode: 'enforced',
      revision: 3,
    });
    expect(rayenSyncMetaFromEvent(event)).not.toHaveProperty('performance');
    expect(JSON.stringify(event)).not.toMatch(/patient|rut|diagn|indication/i);
  });

  it('orders newest first, deduplicates by run id and caps the day at twenty events', () => {
    let history = Array.from({ length: MAX_RAYEN_SYNC_HISTORY + 4 }, (_, index) =>
      buildAppliedRayenSyncEvent(
        run(`run-${index}`, `2026-07-14T10:${String(index).padStart(2, '0')}:00.000Z`),
        diff(0),
        `2026-07-14T10:${String(index).padStart(2, '0')}:30.000Z`
      )
    );
    const replacement = { ...history[5], status: 'partial' as const };
    history = upsertRayenSyncEvent(history, replacement);

    expect(history).toHaveLength(MAX_RAYEN_SYNC_HISTORY);
    expect(history[0].id).toBe('run-23');
    expect(history.filter(event => event.id === replacement.id)).toEqual([replacement]);
  });

  it('computes patient coverage without treating a global source error as a patient', () => {
    const coverage = buildRayenSyncCoverage(
      4,
      [
        { bedId: 'R1', source: 'patch', reason: 'write_failed', message: 'first' },
        { bedId: 'R1', source: 'patch', reason: 'write_failed', message: 'second' },
        { bedId: '*', source: 'patch', reason: 'write_failed', message: 'global' },
      ],
      '2026-07-14T10:04:00.000Z'
    );

    expect(coverage).toEqual({
      total: 4,
      completed: 3,
      errors: 1,
      sourceErrors: 3,
      issues: [
        { bedId: 'R1', source: 'patch', reason: 'write_failed' },
        { bedId: '*', source: 'patch', reason: 'write_failed' },
      ],
      completedAt: '2026-07-14T10:04:00.000Z',
    });
  });

  it('persists the typed reason instead of reclassifying raw error copy', () => {
    const coverage = buildRayenSyncCoverage(
      9,
      [
        {
          bedId: 'R2',
          source: 'patch',
          reason: 'concurrent_write',
          message: 'El proveedor cambió por completo la redacción del conflicto.',
        },
      ],
      '2026-07-17T07:02:25.000Z'
    );

    expect(coverage).toMatchObject({
      completed: 8,
      errors: 1,
      issues: [{ bedId: 'R2', source: 'patch', reason: 'concurrent_write' }],
    });
    expect(JSON.stringify(coverage)).not.toContain('proveedor');
  });

  it('preserves staffing as an actionable clinical source without persisting its raw error', () => {
    const coverage = buildRayenSyncCoverage(
      2,
      [
        {
          bedId: 'H2C1',
          source: 'staffing',
          reason: 'source_unavailable',
          message: 'Error interno de historial 503',
        },
      ],
      '2026-07-17T07:02:25.000Z'
    );

    expect(coverage.issues).toEqual([
      { bedId: 'H2C1', source: 'staffing', reason: 'source_unavailable' },
    ]);
    expect(JSON.stringify(coverage)).not.toContain('Error interno');
  });

  it('finalizes as complete or partial while updating the same event', () => {
    const applied = buildAppliedRayenSyncEvent(run(), diff(), '2026-07-14T10:01:00.000Z');
    const complete = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(2, [], '2026-07-14T10:03:00.000Z')
    );
    const partial = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(
        2,
        [{ bedId: 'R2', source: 'patch', reason: 'write_failed', message: 'failed' }],
        '2026-07-14T10:03:00.000Z'
      )
    );

    expect(complete).toMatchObject({ id: applied.id, status: 'complete' });
    expect(partial).toMatchObject({ id: applied.id, status: 'partial' });
  });

  it('keeps structural review evidence visible after clinical coverage completes', () => {
    const applied = buildAppliedRayenSyncEvent(run(), diff(), '2026-07-14T10:01:00.000Z');
    const completed = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(2, [], '2026-07-14T10:03:00.000Z'),
      undefined,
      undefined,
      {
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 1,
      }
    );

    expect(completed).toMatchObject({
      id: applied.id,
      status: 'partial',
      coverage: { total: 2, completed: 2, errors: 0 },
      structuralReview: {
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 1,
      },
    });
  });

  it('retains deferred D-1 admission evidence without marking current-day coverage partial', () => {
    const applied = buildAppliedRayenSyncEvent(run(), diff(), '2026-07-14T10:01:00.000Z');
    const completed = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(2, [], '2026-07-14T10:03:00.000Z'),
      undefined,
      undefined,
      {
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 0,
        deferredHistoricalAdmissionBedIds: ['H5C2'],
      }
    );

    expect(completed).toMatchObject({
      status: 'complete',
      structuralReview: { deferredHistoricalAdmissionBedIds: ['H5C2'] },
    });
  });

  it('classifies resumable structural follow-up without persisting raw error text', () => {
    const coverage = buildRayenSyncCoverage(
      0,
      [
        {
          bedId: '*',
          source: 'patch',
          reason: 'historical_census_write_failed',
          message: 'historical_census_write_failed',
        },
        {
          bedId: '*',
          source: 'patch',
          reason: 'structural_conflict',
          message: 'structural_conflicts_pending',
        },
      ],
      '2026-07-14T10:03:00.000Z'
    );

    expect(coverage).toMatchObject({
      total: 0,
      completed: 0,
      errors: 0,
      sourceErrors: 2,
      issues: [
        { bedId: '*', source: 'patch', reason: 'historical_census_write_failed' },
        { bedId: '*', source: 'patch', reason: 'structural_conflict' },
      ],
    });
  });

  it('replaces the applied performance snapshot with the completed aggregate', () => {
    const applied = buildAppliedRayenSyncEvent(
      {
        ...run(),
        performance: {
          stagesMs: { preflight: 100 },
          counters: { requests: 1, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
        },
      },
      diff(),
      '2026-07-14T10:01:00.000Z'
    );
    const performance = {
      stagesMs: { preflight: 100, clinicalReads: 2_000, persistence: 300 },
      counters: { requests: 5, cacheHits: 1, patches: 2, retries: 0, timeouts: 0 },
    };

    const completed = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(1, [], '2026-07-14T10:03:00.000Z'),
      undefined,
      performance
    );

    expect(completed.performance).toEqual(performance);
    expect(JSON.stringify(completed.performance)).not.toMatch(/rut|patientName|bedId|encounterId/i);
  });

  it('preserves source-quality evidence when later stages add performance counters', () => {
    const sourceQuality = {
      treatingPhysicians: {
        encounters: 10,
        catalogEntries: 12,
        assignedEncounters: 8,
        sourceResolvedNames: 6,
        plannedResolvedNames: 8,
      },
    };
    const merged = mergeRayenSyncPerformance(
      {
        stagesMs: { dualCapture: 500 },
        counters: { requests: 2, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
        sourceQuality,
      },
      { stagesMs: { clinicalReads: 1_000 }, counters: { requests: 4, patches: 1 } }
    );

    expect(merged).toMatchObject({
      stagesMs: { dualCapture: 500, clinicalReads: 1_000 },
      counters: { requests: 6, patches: 1 },
      sourceQuality,
    });
    expect(JSON.stringify(merged?.sourceQuality)).not.toMatch(
      /Angelica|11\.111\.111|H1C1|episode-1/i
    );
  });

  it('merges contextual coordination as aggregate-only telemetry', () => {
    const merged = mergeRayenSyncPerformance(
      {
        stagesMs: {},
        counters: { requests: 0, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
        coordination: {
          target: 'historical',
          structuralReplans: 1,
          confirmedEpisodes: 8,
          omittedEpisodes: 2,
          clinicalRetries: 0,
        },
      },
      {
        coordination: {
          structuralReplans: 1,
          confirmedEpisodes: 9,
          omittedEpisodes: 1,
          clinicalRetries: 2,
        },
      }
    );

    expect(merged?.coordination).toEqual({
      target: 'historical',
      structuralReplans: 2,
      confirmedEpisodes: 9,
      omittedEpisodes: 1,
      clinicalRetries: 2,
    });
    expect(JSON.stringify(merged?.coordination)).not.toMatch(
      /rut|patient|bed|encounter|clinicalEpisodeId/i
    );
  });

  it('omits an unknown target when adding coordination to legacy telemetry', () => {
    const merged = mergeRayenSyncPerformance(undefined, {
      coordination: { clinicalRetries: 1 },
    });

    expect(merged?.coordination).toEqual({
      structuralReplans: 0,
      confirmedEpisodes: 0,
      omittedEpisodes: 0,
      clinicalRetries: 1,
    });
    expect(merged?.coordination).not.toHaveProperty('target');
  });

  it('persists a privacy-safe explanation for ambiguous staffing evidence', () => {
    const observation = buildRayenStaffingObservation({
      censusDate: '2026-07-25',
      day: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
      night: {
        names: [],
        candidates: [],
        ignoredBoundaryRecords: 2,
        ignoredBoundaryEvidence: [
          {
            name: 'Camila Soto',
            role: 'Enfermera(o)',
            recordedAt: '2026-07-25T20:30:00',
            source: 'vital-signs',
            boundary: 'night_start',
          },
          {
            name: 'Camila Soto',
            role: 'Enfermera(o)',
            recordedAt: '2026-07-25T20:30:00',
            source: 'vital-signs',
            boundary: 'night_start',
          },
        ],
        ambiguous: true,
      },
      tensDay: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
      tensNight: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
    });
    const applied = buildAppliedRayenSyncEvent(run(), diff(), '2026-07-14T10:01:00.000Z');
    const completed = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(2, [], '2026-07-14T10:03:00.000Z'),
      observation
    );

    expect(completed.staffingObservation).toEqual({
      ambiguousSections: ['nurse_night'],
      ignoredBoundaryRecords: 2,
      ignoredBoundaryEvidence: [
        {
          section: 'nurse_night',
          name: 'Camila Soto',
          role: 'Enfermera(o)',
          recordedAt: '2026-07-25T20:30:00',
          source: 'vital-signs',
          boundary: 'night_start',
        },
      ],
    });
    expect(JSON.stringify(completed.staffingObservation)).not.toMatch(/patient|rut|diagn/i);
  });

  it('does not mark nursing as incomplete when both standard slots are covered', () => {
    const observation = buildRayenStaffingObservation({
      censusDate: '2026-07-25',
      day: {
        names: ['Camila Soto', 'Pedro Moreno'],
        candidates: [],
        ignoredBoundaryRecords: 0,
        ambiguous: true,
      },
      night: { names: [], candidates: [], ignoredBoundaryRecords: 0, ambiguous: false },
    });

    expect(observation).toBeUndefined();
  });

  it('stores failed attempts with a sanitized reason and without replacing last-sync metadata', () => {
    const failed = buildFailedRayenSyncEvent(
      run(),
      'extension_unavailable',
      '2026-07-14T10:00:05.000Z'
    );

    expect(failed).toMatchObject({ status: 'failed', failureReason: 'extension_unavailable' });
    expect(failed).not.toHaveProperty('coverage');
    expect(failed).not.toHaveProperty('changes');
  });
});
