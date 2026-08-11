import { useCallback } from 'react';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
import { applyCensusImportDiff } from '../domain/applyCensusImportDiff';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import {
  resolveConfirmedRayenCensusHandoff,
  resolveStructuralStageResult,
  type ConfirmedRayenCensusHandoff,
  type RayenCensusPersistencePayload,
  type StructuralStageResult,
} from './rayenCensusPersistenceGuard';

export interface ConfirmedRayenCensusApplyResult extends ApplyResult {
  confirmedHandoff: ConfirmedRayenCensusHandoff;
  structuralStage: StructuralStageResult;
}

interface RayenCensusDiffApplicationInput {
  ensureRun: () => RayenSyncRun;
  applyRunToRecord: (record: DailyRecord, diff: CensusImportDiff) => { record: DailyRecord };
  saveDailyRecord: (
    record: DailyRecord,
    expectedLastUpdated: string
  ) => Promise<RayenCensusPersistencePayload>;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
}

/** Applies and persists the structural census diff while timing only its aggregate write stage. */
export const useRayenCensusDiffApplication = ({
  ensureRun,
  applyRunToRecord,
  saveDailyRecord,
  recordRunPerformance,
}: RayenCensusDiffApplicationInput) =>
  useCallback(
    async (
      record: DailyRecord,
      diff: CensusImportDiff,
      clinicalDay: string = record.date
    ): Promise<ConfirmedRayenCensusApplyResult> => {
      const run = ensureRun();
      const result = applyCensusImportDiff(record, diff, {
        idFactory: () => crypto.randomUUID(),
        actor: run.by,
        syncRunId: run.id,
      });
      const stamped = applyRunToRecord(result.record, diff).record;
      const startedAt = Date.now();
      // applyCensusImportDiff stamps a new lastUpdated. The CAS token must remain the revision of
      // the base record, especially for a historical day, otherwise every legitimate save is 409.
      const persistence = await saveDailyRecord(stamped, record.lastUpdated);
      const confirmedHandoff = resolveConfirmedRayenCensusHandoff(persistence, {
        date: stamped.date,
        clinicalDay,
        runId: run.id,
        diff,
      });
      const structuralStage = resolveStructuralStageResult(confirmedHandoff);
      recordRunPerformance(
        {
          stagesMs: { persistence: elapsedMilliseconds(startedAt) },
          counters: { patches: 1 },
          coordination: {
            confirmedEpisodes: confirmedHandoff.safeClinicalEpisodeIds.length,
            omittedEpisodes: confirmedHandoff.isolatedConflicts.length,
          },
        },
        run.id
      );
      return {
        ...result,
        record: confirmedHandoff.record,
        confirmedHandoff,
        structuralStage,
      };
    },
    [applyRunToRecord, ensureRun, recordRunPerformance, saveDailyRecord]
  );
