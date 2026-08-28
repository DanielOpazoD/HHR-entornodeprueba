import { useCallback } from 'react';
import type { ApplyResult } from '../domain/applyCensusImportDiff';
import { applyCensusImportDiff } from '../domain/applyCensusImportDiff';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { RayenSyncRun } from '../domain/rayenSyncHistory';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';
import type { LocalDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import { buildRayenStructuralPersistenceBase } from '../domain/rayenStructuralPersistenceBase';
import {
  runExclusiveDailyRecordWrite,
  type DailyRecordWriteLease,
} from '@/services/repositories/dailyRecordWriteCoordinator';
import {
  resolveConfirmedRayenCensusHandoff,
  resolveStructuralStageResult,
  type ConfirmedRayenCensusHandoff,
  type RayenCensusPersistencePayload,
  type StructuralStageResult,
} from './rayenCensusPersistenceGuard';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { hasUnchangedRayenStructuralState } from '../domain/rayenStructuralCheckpoint';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { QueryClient } from '@tanstack/react-query';
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import { markDailyRecordRemoteConfirmed } from '@/hooks/controllers/dailyRecordFreshnessGateController';

export interface ConfirmedRayenCensusApplyResult extends ApplyResult {
  confirmedHandoff: ConfirmedRayenCensusHandoff;
  structuralStage: StructuralStageResult;
}

interface RayenCensusDiffApplicationInput {
  ensureRun: () => RayenSyncRun;
  applyRunToRecord: (record: DailyRecord, diff: CensusImportDiff) => { record: DailyRecord };
  saveDailyRecord: (
    record: DailyRecord,
    expectedLastUpdated: string,
    writeLease: DailyRecordWriteLease
  ) => Promise<RayenCensusPersistencePayload>;
  checkpointRepository: Pick<DailyRecordRepositoryPort, 'updatePartialDetailed'>;
  queryClient: QueryClient;
  loadLocalRecord: (date: string) => Promise<LocalDailyRecordReadResult>;
  recordRunPerformance: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
}

/** Applies and persists the structural census diff while timing only its aggregate write stage. */
export const useRayenCensusDiffApplication = ({
  ensureRun,
  applyRunToRecord,
  saveDailyRecord,
  checkpointRepository,
  queryClient,
  loadLocalRecord,
  recordRunPerformance,
}: RayenCensusDiffApplicationInput) =>
  useCallback(
    async (
      record: DailyRecord,
      diff: CensusImportDiff,
      clinicalDay: string = record.date
    ): Promise<ConfirmedRayenCensusApplyResult> =>
      runExclusiveDailyRecordWrite(record.date, async writeLease => {
        const run = ensureRun();
        const localResult = await loadLocalRecord(record.date);
        const persistenceBase = buildRayenStructuralPersistenceBase(
          record,
          localResult.record,
          diff,
          {
            localWriteState: localResult.writeState,
          }
        );
        const result = applyCensusImportDiff(persistenceBase, diff, {
          idFactory: () => crypto.randomUUID(),
          actor: run.by,
          syncRunId: run.id,
        });
        const stamped = applyRunToRecord(result.record, diff).record;
        const startedAt = Date.now();
        // applyCensusImportDiff stamps a new lastUpdated. CAS must keep the base record revision,
        // especially for a historical day, otherwise every legitimate save is 409.
        const canUseMetadataCheckpoint =
          !localResult.hasPendingWrites &&
          localResult.writeState === 'none' &&
          hasUnchangedRayenStructuralState(persistenceBase, result.record);
        let persistence: RayenCensusPersistencePayload;
        if (canUseMetadataCheckpoint) {
          const checkpointResult = await checkpointRepository.updatePartialDetailed(
            persistenceBase.date,
            {
              rayenSync: stamped.rayenSync,
              rayenSyncHistory: stamped.rayenSyncHistory,
            } satisfies DailyRecordPatch,
            {
              baseRecord: persistenceBase,
              historyPolicy: 'skip',
              requireAtomicCas: true,
              requireConfirmedRecord: true,
              requireRemoteAuthorityFirst: true,
              dailyRecordWriteLease: writeLease,
            }
          );
          persistence = {
            record: checkpointResult.confirmedRecord ?? persistenceBase,
            result: checkpointResult,
          };
          if (checkpointResult.confirmedRecord) {
            markDailyRecordRemoteConfirmed(persistenceBase.date, {
              source: 'write',
              remoteLastUpdated: checkpointResult.confirmedRecord.lastUpdated,
              previousRecord: persistenceBase,
              confirmedRecord: checkpointResult.confirmedRecord,
            });
            setDailyRecordQueryData(
              queryClient,
              persistenceBase.date,
              checkpointResult.confirmedRecord
            );
          }
        } else {
          persistence = await saveDailyRecord(stamped, record.lastUpdated, writeLease);
        }
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
      }),
    [
      applyRunToRecord,
      checkpointRepository,
      ensureRun,
      loadLocalRecord,
      queryClient,
      recordRunPerformance,
      saveDailyRecord,
    ]
  );
