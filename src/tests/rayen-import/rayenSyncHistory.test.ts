import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  MAX_RAYEN_SYNC_HISTORY,
  buildAppliedRayenSyncEvent,
  buildFailedRayenSyncEvent,
  buildRayenSyncCoverage,
  completeRayenSyncEvent,
  rayenSyncMetaFromEvent,
  upsertRayenSyncEvent,
  type RayenSyncRun,
} from '@/features/rayen-import/domain/rayenSyncHistory';

const run = (id = 'run-1', startedAt = '2026-07-14T10:00:00.000Z'): RayenSyncRun => ({
  id,
  startedAt,
  by: 'Operador HHR',
  source: {
    extensionVersion: '0.5.0',
    protocolVersion: 1,
    fichaMedico: 'ready',
    gestionCamas: 'ready',
  },
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
    const event = buildAppliedRayenSyncEvent(run(), diff(), '2026-07-14T10:01:00.000Z');
    const history = upsertRayenSyncEvent(undefined, event);

    expect(history).toEqual([event]);
    expect(rayenSyncMetaFromEvent(event)).toMatchObject({
      at: run().startedAt,
      by: 'Operador HHR',
      runId: 'run-1',
      status: 'applied',
    });
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
      [{ bedId: 'R1' }, { bedId: 'R1' }, { bedId: '*' }],
      '2026-07-14T10:04:00.000Z'
    );

    expect(coverage).toEqual({
      total: 4,
      completed: 3,
      errors: 1,
      sourceErrors: 3,
      completedAt: '2026-07-14T10:04:00.000Z',
    });
  });

  it('finalizes as complete or partial while updating the same event', () => {
    const applied = buildAppliedRayenSyncEvent(run(), diff(), '2026-07-14T10:01:00.000Z');
    const complete = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(2, [], '2026-07-14T10:03:00.000Z')
    );
    const partial = completeRayenSyncEvent(
      applied,
      buildRayenSyncCoverage(2, [{ bedId: 'R2' }], '2026-07-14T10:03:00.000Z')
    );

    expect(complete).toMatchObject({ id: applied.id, status: 'complete' });
    expect(partial).toMatchObject({ id: applied.id, status: 'partial' });
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
