import { useCallback, type Dispatch } from 'react';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { describeRayenPlanningFailure, type RayenImportState } from './rayenImportState';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
import { logError } from '@/services/utils/errorService';
import { defaultMonotonicNow, elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import { useTreatingPhysicianCatalogSync } from './useTreatingPhysicianCatalogSync';
import { buildRayenCapturePerformance } from '../domain/rayenSyncSourceQuality';
import {
  isRayenSyncExecutionCurrent,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionOutcome,
  type RayenSyncStage,
} from './rayenSyncExecutionState';
import {
  hasNoApplicableRayenStructuralChanges,
  resolveRayenSnapshotPlanningStage,
} from './rayenSnapshotPlanningDecision';
import type { UseRayenSnapshotPreviewInput } from './rayenSnapshotPreviewContracts';
import { prepareRayenStructuralPlan } from './prepareRayenStructuralPlan';
import { persistRayenStructureThenClinical } from './rayenSnapshotPersistenceExecution';
import {
  matchesRayenStructuralReplan,
  startRayenStructuralReviewTiming,
} from './rayenStructuralConvergence';
import {
  createRayenPlanningMetrics,
  prepareRayenSnapshotEvidence,
} from './rayenSnapshotPreviewPreparation';
import { raceWithTimeout } from '../domain/raceWithTimeout';

interface RayenSnapshotExecutionIdentity {
  runId: string;
  requestId: string;
  selectedDate?: string;
}

const createRayenSnapshotExecutionReporter = (
  dispatch: Dispatch<RayenSyncExecutionAction>,
  identity: RayenSnapshotExecutionIdentity
) => ({
  transition(stage: RayenSyncStage) {
    dispatch({ type: 'transition', ...identity, stage });
  },
  recordOutcome(outcome: Partial<RayenSyncExecutionOutcome>) {
    dispatch({ type: 'record_outcome', ...identity, ...outcome });
  },
});

const INVALID_EPISODE_LOAD_TIMEOUT_MS = 30_000;
const INVALID_EPISODE_LOAD_ERROR =
  'La lista de pacientes no válidos todavía no se leyó. Revisa la conexión y vuelve a intentar.';

export const useRayenSnapshotPreview = ({
  dailyRecord,
  isAdmin,
  setState,
  dispatchExecution = () => undefined,
  executionRef,
  selectedDateRef,
  clearSyncTimeout,
  applyDiff,
  runClinicalStage,
  failRun,
  ensureRun,
  getRun,
  recordRunPerformance,
  preparedSyncContextRef,
  structuralReplanRef,
  structuralPersistenceExecutionKeysRef,
  runSerializedPersistence,
  loadAuthoritativeStructuralRecord,
  loadInvalidEpisodeIds,
  invalidEpisodeLoadTimeoutMs = INVALID_EPISODE_LOAD_TIMEOUT_MS,
  monotonicNow = defaultMonotonicNow,
}: UseRayenSnapshotPreviewInput) => {
  const prepareTreatingPhysicianSnapshot = useTreatingPhysicianCatalogSync();
  return useCallback(
    async (
      snapshot: RayenCensusSnapshot,
      bundle: RayenSyncBundle,
      requestedRunId: string,
      requestId: string
    ) => {
      const run = requestedRunId ? getRun(requestedRunId) : ensureRun();
      if (!run) return;
      const requestIdentity = { runId: run.id, requestId };
      if (!isRayenSyncExecutionCurrent(executionRef.current, requestIdentity)) return;
      clearSyncTimeout();
      const planningSnapshot = prepareTreatingPhysicianSnapshot(snapshot);
      const preparedContext = preparedSyncContextRef.current;
      if (!preparedContext || preparedContext.runId !== run.id) {
        createRayenSnapshotExecutionReporter(dispatchExecution, {
          runId: run.id,
          requestId,
        }).transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id).catch(() => undefined);
        setState(prev => ({
          ...prev,
          error:
            'La fecha y el turno de esta sincronización quedaron por confirmar. Vuelve a sincronizar.',
        }));
        return;
      }
      const authoritativeBaseRecord = preparedContext.record;
      structuralReplanRef.current = null;
      const executionIdentity = {
        runId: run.id,
        requestId,
        selectedDate: preparedContext.selectedDate,
      };
      if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) return;
      const session = guardAuthoringSession();
      // A failure that arrives after the session or the execution changed belongs to no one.
      const ownsPlanning = () =>
        isRayenSyncExecutionCurrent(executionRef.current, executionIdentity) && session.isCurrent();
      const execution = createRayenSnapshotExecutionReporter(dispatchExecution, executionIdentity);
      execution.transition({ type: 'planning_structure' });
      recordRunPerformance(
        buildRayenCapturePerformance(
          snapshot,
          planningSnapshot,
          elapsedMilliseconds(Date.parse(run.startedAt)),
          bundle.captureTimingsMs,
          bundle.captureRetries
        ),
        run.id
      );
      const stopPlanning = (failure: Pick<RayenImportState, 'error' | 'errorTechnicalDetail'>) => {
        execution.transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id).catch(() => undefined);
        setState(prev => ({ ...prev, ...failure }));
      };
      const metrics = createRayenPlanningMetrics();
      const evidence = prepareRayenSnapshotEvidence(preparedContext, snapshot, bundle);
      if (!evidence.valid) {
        stopPlanning({ error: evidence.error });
        return;
      }
      // Without the marks the sync could admit a removed patient again or file its egreso.
      let invalidEpisodeIds: ReadonlySet<string>;
      try {
        invalidEpisodeIds = await metrics.measureEvidence(() =>
          raceWithTimeout(
            loadInvalidEpisodeIds(),
            invalidEpisodeLoadTimeoutMs,
            () => new Error(INVALID_EPISODE_LOAD_ERROR)
          )
        );
      } catch {
        if (!ownsPlanning()) return;
        stopPlanning({ error: INVALID_EPISODE_LOAD_ERROR });
        return;
      }
      if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) return;
      let structuralPlan: Awaited<ReturnType<typeof prepareRayenStructuralPlan>>;
      try {
        structuralPlan = await prepareRayenStructuralPlan({
          baseRecord: authoritativeBaseRecord,
          planningSnapshot,
          bundle,
          isHistoricalDay: evidence.isHistoricalDay,
          reportDate: evidence.reportDate,
          dailyRecord,
          isAdmin,
          counters: metrics.counters,
          measureEvidence: metrics.measureEvidence,
          invalidEpisodeIds,
        });
      } catch (error) {
        // A failed evidence read or a refused reconstruction proposes nothing and saves nothing.
        if (!ownsPlanning()) return;
        const { unforeseen, ...failure } = describeRayenPlanningFailure(error);
        if (unforeseen) {
          logError(
            'Rayen structural planning failed',
            error instanceof Error ? error : new Error(String(error)),
            { operation: 'rayen_structural_planning' }
          );
        }
        stopPlanning(failure);
        return;
      }
      const { diff, replanDiff } = structuralPlan;
      if (!isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)) return;
      structuralReplanRef.current = {
        ...executionIdentity,
        clinicalDay: preparedContext.target.clinicalDay,
        replan: replanDiff,
      };
      recordRunPerformance(
        {
          stagesMs: {
            reconciliation: elapsedMilliseconds(metrics.reconciliationStartedAt),
            historicalEvidence: metrics.getHistoricalEvidenceMs(),
          },
          counters: metrics.counters,
        },
        run.id
      );
      const structuralConflictCount = Math.max(diff.conflicts.length, diff.summary.conflicts);
      execution.recordOutcome({ structuralConflicts: structuralConflictCount });
      const hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
      if (hasNoApplicableChanges) {
        await persistRayenStructureThenClinical({
          identity: executionIdentity,
          afterReview: false,
          applyPreviousDays: false,
          preparePlan: () => ({
            base: authoritativeBaseRecord,
            diff,
            replanDiff,
            clinicalDay: preparedContext.target.clinicalDay,
          }),
          executionRef,
          dispatchExecution,
          setState,
          selectedDateRef,
          preparedSyncContextRef,
          structuralReplanRef,
          structuralPersistenceExecutionKeysRef,
          runSerializedPersistence,
          dailyRecord,
          isAdmin,
          ensureRun,
          applyDiff,
          loadAuthoritativeStructuralRecord,
          recordRunPerformance,
          failRun,
          runClinicalStage,
          monotonicNow,
        });
        // Clinical completion settles the execution; the commit published its review before that.
        return;
      }
      const isExecutionDateVisible =
        !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
      if (
        isExecutionDateVisible &&
        isRayenSyncExecutionCurrent(executionRef.current, executionIdentity)
      ) {
        setState({ diff, isPreviewOpen: true, result: null, hasSkippedItems: false, error: null });
      }
      const reviewStage = resolveRayenSnapshotPlanningStage(
        hasNoApplicableChanges,
        structuralConflictCount > 0
      );
      const replan = structuralReplanRef.current;
      if (
        (reviewStage.type === 'awaiting_review' || reviewStage.type === 'needs_review') &&
        matchesRayenStructuralReplan(replan, executionIdentity)
      ) {
        structuralReplanRef.current = startRayenStructuralReviewTiming(replan, monotonicNow);
      }
      execution.transition(reviewStage);
    },
    [
      applyDiff,
      clearSyncTimeout,
      dailyRecord,
      dispatchExecution,
      ensureRun,
      executionRef,
      failRun,
      runClinicalStage,
      getRun,
      isAdmin,
      loadAuthoritativeStructuralRecord,
      loadInvalidEpisodeIds,
      invalidEpisodeLoadTimeoutMs,
      monotonicNow,
      preparedSyncContextRef,
      prepareTreatingPhysicianSnapshot,
      recordRunPerformance,
      runSerializedPersistence,
      selectedDateRef,
      setState,
      structuralReplanRef,
      structuralPersistenceExecutionKeysRef,
    ]
  );
};
