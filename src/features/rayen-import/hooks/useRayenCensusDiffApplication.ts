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
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
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
  loadAuthoritativeRecord: (date: string) => Promise<DailyRecord>;
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
  loadAuthoritativeRecord,
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
          !localResult.hasPendingWritesForDate &&
          localResult.writeState === 'none' &&
          hasUnchangedRayenStructuralState(persistenceBase, result.record);
        let persistence: RayenCensusPersistencePayload;
        if (canUseMetadataCheckpoint) {
          const authoritativeCheckpointBase = await loadAuthoritativeRecord(persistenceBase.date);
          if (!hasUnchangedRayenStructuralState(persistenceBase, authoritativeCheckpointBase)) {
            const stalePlan = new Error(
              'El censo cambió mientras se preparaba el checkpoint de sincronización.'
            );
            stalePlan.name = 'ConcurrencyError';
            throw stalePlan;
          }
          // The structural state is unchanged, but audit metadata may have advanced since planning
          // (for example, when a previous failed run was recorded). Stamp the current run onto the
          // fresh server base so the metadata patch cannot overwrite newer history or use stale CAS.
          const checkpointStamped = applyRunToRecord(authoritativeCheckpointBase, diff).record;
          const checkpointResult = await checkpointRepository.updatePartialDetailed(
            persistenceBase.date,
            {
              rayenSync: checkpointStamped.rayenSync,
              rayenSyncHistory: checkpointStamped.rayenSyncHistory,
            } satisfies DailyRecordPatch,
            {
              baseRecord: authoritativeCheckpointBase,
              historyPolicy: 'skip',
              requireAtomicCas: true,
              requireConfirmedRecord: true,
              requireRemoteAuthorityFirst: true,
              dailyRecordWriteLease: writeLease,
            }
          );
          let confirmedCheckpointRecord = checkpointResult.confirmedRecord ?? null;
          const checkpointCommitted = !isDailyRecordWriteRejectedResult(checkpointResult);
          if (checkpointCommitted && confirmedCheckpointRecord?.rayenSync?.runId !== run.id) {
            // Verificado en vivo (31-08): la transacción del checkpoint commitea
            // y estampa el run en el servidor, pero la confirmación devuelta
            // puede venir de una lectura anterior al commit y llegar SIN el
            // sello. La verificación del handoff rechazaba entonces una corrida
            // realmente commiteada («El guardado del censo no confirmó la
            // versión…») y la marcaba fallida. Una única relectura autoritativa
            // recupera el estado real; el guard vuelve a validar el sello y
            // sigue fallando ruidosamente si de verdad no está.
            confirmedCheckpointRecord = await loadAuthoritativeRecord(persistenceBase.date);
          }
          persistence = {
            record: confirmedCheckpointRecord ?? persistenceBase,
            result: checkpointResult,
          };
          if (confirmedCheckpointRecord) {
            markDailyRecordRemoteConfirmed(persistenceBase.date, {
              source: 'write',
              remoteLastUpdated: confirmedCheckpointRecord.lastUpdated,
              previousRecord: persistenceBase,
              confirmedRecord: confirmedCheckpointRecord,
            });
            setDailyRecordQueryData(queryClient, persistenceBase.date, confirmedCheckpointRecord);
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
      loadAuthoritativeRecord,
      loadLocalRecord,
      queryClient,
      recordRunPerformance,
      saveDailyRecord,
    ]
  );
