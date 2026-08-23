import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  planRayenCensusImport,
  type ApplyContext,
  type CensusImportDiff,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  createRayenSyncAcceptanceScenario,
  RAYEN_ACCEPTANCE_REFERENCE,
} from './rayenSyncAcceptanceFixtures';

const mutationCounts = (diff: CensusImportDiff) => ({
  admissions: diff.admissions.length,
  updates: diff.updates.length,
  moves: diff.moves.length,
  discharges: diff.discharges.length,
  conflicts: diff.conflicts.length,
  pendingAdministrativeDischarges: diff.pendingAdministrativeDischarges.length,
});

const clinicalProjection = (record: DailyRecord) => ({
  beds: record.beds,
  discharges: record.discharges,
  transfers: record.transfers,
  cma: record.cma,
});

const applyContext = (run: number): ApplyContext => {
  let sequence = 0;
  return {
    idFactory: () => `fixture-movement-${run}-${++sequence}`,
    now: new Date(2026, 6, 31, 14, run, 0),
    actor: 'Profesional Fixture',
    syncRunId: `fixture-sync-run-${run}`,
  };
};

describe('clinical sync simulator · Rayen acceptance contract', () => {
  it('converges a mixed fictional census and makes the repeated snapshot a clinical no-op', () => {
    const scenario = createRayenSyncAcceptanceScenario();
    const firstPlan = planRayenCensusImport({
      current: scenario.current,
      snapshot: scenario.snapshot,
      reference: RAYEN_ACCEPTANCE_REFERENCE,
    }).diff;

    expect(mutationCounts(firstPlan)).toEqual({
      admissions: 1,
      updates: 2,
      moves: 1,
      discharges: 0,
      conflicts: 0,
      pendingAdministrativeDischarges: 0,
    });
    for (const excludedEpisodeId of scenario.episodes.pavilionRecovery) {
      expect(firstPlan.activeClinicalEpisodeIds).not.toContain(excludedEpisodeId);
    }

    const firstApply = applyCensusImportDiff(scenario.current, firstPlan, applyContext(1));

    expect(firstApply.skipped).toEqual([]);
    expect(firstApply.applied).toEqual({ admissions: 1, updates: 2, moves: 1, discharges: 0 });
    expect(firstApply.record.beds.NEO1?.clinicalEpisodeId).toBe(scenario.episodes.admitted);
    expect(firstApply.record.beds.H1C2).toMatchObject({
      clinicalEpisodeId: scenario.episodes.moved,
      handoffNote: 'Nota local preservada',
    });
    expect(firstApply.record.beds.H2C1).toBeUndefined();
    expect(firstApply.record.beds.H4C1).toMatchObject({
      clinicalEpisodeId: scenario.episodes.mother,
      clinicalCrib: {
        clinicalEpisodeId: scenario.episodes.newborn,
        bedMode: 'Cuna',
      },
    });
    expect(firstApply.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: scenario.episodes.updated,
      pathology: 'Diagnostico fixture actualizado',
      treatingPhysicianId: 'fixture-practitioner-2',
      treatingPhysicianName: 'Profesional Fixture Dos',
      specialty: 'Especialidad local anterior',
      handoffNote: 'Otra nota local preservada',
    });
    const activeEpisodeIds = Object.values(firstApply.record.beds).map(
      patient => patient?.clinicalEpisodeId
    );
    for (const excludedEpisodeId of scenario.episodes.pavilionRecovery) {
      expect(activeEpisodeIds).not.toContain(excludedEpisodeId);
    }

    const projectionBeforeReplay = structuredClone(clinicalProjection(firstApply.record));
    const repeatedPlan = planRayenCensusImport({
      current: firstApply.record,
      snapshot: scenario.snapshot,
      reference: RAYEN_ACCEPTANCE_REFERENCE,
    }).diff;
    expect(mutationCounts(repeatedPlan)).toEqual({
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      conflicts: 0,
      pendingAdministrativeDischarges: 0,
    });

    const repeatedApply = applyCensusImportDiff(firstApply.record, repeatedPlan, applyContext(2));
    expect(repeatedApply.applied).toEqual({ admissions: 0, updates: 0, moves: 0, discharges: 0 });
    expect(repeatedApply.skipped).toEqual([]);
    expect(clinicalProjection(repeatedApply.record)).toEqual(projectionBeforeReplay);
  });
});
