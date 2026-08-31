import { useCallback } from 'react';
import { requiresReview } from '../domain/reconcileCensus';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { getRayenImportErrorMessage } from './rayenImportState';
import { defaultMonotonicNow, elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import { useTreatingPhysicianCatalogSync } from './useTreatingPhysicianCatalogSync';
import { buildRayenCapturePerformance } from '../domain/rayenSyncSourceQuality';
import { isRayenSyncExecutionCurrent, rayenSyncExecutionKey } from './rayenSyncExecutionState';
import { createRayenSnapshotExecutionReporter } from './rayenSnapshotExecutionReporter';
import {
  hasNoApplicableRayenStructuralChanges,
  resolveRayenSnapshotPlanningStage,
  shouldOpenRayenSnapshotPreview,
} from './rayenSnapshotPlanningDecision';
import type { UseRayenSnapshotPreviewInput } from './rayenSnapshotPreviewContracts';
import { applyConfirmedRayenImport } from './confirmRayenImport';
import { prepareRayenStructuralPlan } from './prepareRayenStructuralPlan';
import type { RayenStructuralCommitSummary } from './rayenStructuralCommitOutcome';
import { runRayenStructuralPersistenceLifecycle } from './rayenSnapshotPersistenceExecution';
import {
  matchesRayenStructuralReplan,
  startRayenStructuralReviewTiming,
} from './rayenStructuralConvergence';
import {
  createRayenPlanningMetrics,
  prepareRayenSnapshotEvidence,
  returnRayenReplanToReview,
} from './rayenSnapshotPreviewPreparation';

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
      if (!isRayenSyncExecutionCurrent(executionRef?.current, requestIdentity)) return;
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
          isSyncing: false,
          error: 'No se pudo confirmar el contexto temporal de esta sincronización.',
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
      if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
      const execution = createRayenSnapshotExecutionReporter(dispatchExecution, executionIdentity);
      const returnReplanToReview = (error: unknown) =>
        returnRayenReplanToReview({
          error,
          preparedContext,
          preparedContextRef: preparedSyncContextRef,
          transition: execution.transition,
          setState,
        });
      execution.transition({ type: 'planning_structure' });
      recordRunPerformance(
        buildRayenCapturePerformance(
          snapshot,
          planningSnapshot,
          elapsedMilliseconds(Date.parse(run.startedAt))
        ),
        run.id
      );
      const metrics = createRayenPlanningMetrics();
      const evidence = prepareRayenSnapshotEvidence(preparedContext, snapshot, bundle);
      if (!evidence.valid) {
        execution.transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id).catch(() => undefined);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error: evidence.error,
        }));
        return;
      }
      const structuralPlan = await prepareRayenStructuralPlan({
        baseRecord: authoritativeBaseRecord,
        planningSnapshot,
        bundle,
        isHistoricalDay: evidence.isHistoricalDay,
        reportDate: evidence.reportDate,
        dailyRecord,
        isAdmin,
        counters: metrics.counters,
        measureEvidence: metrics.measureEvidence,
      });
      const { replanDiff } = structuralPlan;
      let diff = structuralPlan.diff;
      if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
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
      const previousDayEdits = diff.previousDayEdits ?? [];
      const needsReview = requiresReview(diff) || previousDayEdits.length > 0;
      const canAutoApply = run.policy?.mode === 'auto' && !needsReview;
      const structuralConflictCount = Math.max(diff.conflicts.length, diff.summary.conflicts);
      execution.recordOutcome({ structuralConflicts: structuralConflictCount });
      const persistConvergedStructure = () =>
        runSerializedPersistence(() => {
          if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) {
            return Promise.resolve(null);
          }
          return applyConfirmedRayenImport({
            applyPreviousDays: false,
            base: authoritativeBaseRecord,
            diff,
            dailyRecord,
            isAdmin,
            ensureRun,
            applyDiff,
            getFreshRecord: () => loadAuthoritativeStructuralRecord(authoritativeBaseRecord.date),
            replanDiff,
            clinicalDay: preparedContext.target.clinicalDay,
            createId: () => crypto.randomUUID(),
            onRetry: () =>
              recordRunPerformance(
                {
                  counters: { retries: 1 },
                  coordination: { structuralReplans: 1 },
                },
                run.id
              ),
          });
        });
      const finishFailedPersistence = (error: unknown) => {
        if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
        if (returnReplanToReview(error)) {
          const replan = structuralReplanRef.current;
          if (matchesRayenStructuralReplan(replan, executionIdentity)) {
            structuralReplanRef.current = startRayenStructuralReviewTiming(replan, monotonicNow);
          }
          return;
        }
        preparedSyncContextRef.current = null;
        structuralReplanRef.current = null;
        void failRun('apply_failed', run.id).catch(() => undefined);
        execution.transition({ type: 'failed' });
        const isExecutionDateVisible =
          !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          ...(isExecutionDateVisible ? { error: getRayenImportErrorMessage(error) } : {}),
        }));
      };
      const continueClinicalAfterCommit = async (
        commit: RayenStructuralCommitSummary,
        updateVisibleState?: () => void
      ): Promise<void> => {
        if (isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) {
          execution.recordOutcome({
            structuralConflicts: commit.structuralConflicts,
            skippedItems: commit.skippedItems,
          });
          preparedSyncContextRef.current = null;
          structuralReplanRef.current = null;
          updateVisibleState?.();
          execution.transition({ type: 'verifying_structure' });
          execution.transition({ type: 'syncing_clinical' });
        }
        await runClinicalStage(commit.clinicalHandoff);
      };
      const runPreparedStructuralPersistence = (
        startPersistence: () => void,
        continueAfterCommit: Parameters<
          typeof runRayenStructuralPersistenceLifecycle
        >[0]['continueAfterCommit']
      ) =>
        runRayenStructuralPersistenceLifecycle({
          executionKey: rayenSyncExecutionKey(executionIdentity),
          activeExecutionKeys: structuralPersistenceExecutionKeysRef.current,
          isCurrent: () => isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity),
          startPersistence,
          persist: persistConvergedStructure,
          persistenceOptions: {
            now: monotonicNow,
            onDuration: durationMs => {
              if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
              recordRunPerformance({ stagesMs: { structuralPersistence: durationMs } }, run.id);
            },
          },
          continueAfterCommit,
          finishFailedPersistence,
        });
      if (canAutoApply) {
        await runPreparedStructuralPersistence(
          () => {
            execution.transition({ type: 'persisting_structure' });
            setState({
              diff,
              isPreviewOpen: false,
              isBusy: true,
              isSyncing: true,
              result: null,
              hasSkippedItems: false,
              error: null,
            });
          },
          outcome => {
            const requiresFreshCapture = outcome.kind === 'requires_fresh_capture';
            return continueClinicalAfterCommit(outcome.commit, () =>
              setState(prev => ({
                ...prev,
                diff: outcome.commit.diff,
                isPreviewOpen: false,
                isBusy: false,
                result: outcome.result,
                hasSkippedItems: requiresFreshCapture || outcome.commit.hasSkippedItems,
                ...(requiresFreshCapture
                  ? { error: getRayenImportErrorMessage(outcome.error) }
                  : {}),
              }))
            );
          }
        );
        return;
      }
      let hasUnresolvedConflicts = structuralConflictCount > 0;
      let hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
      let noChangePersistenceCompleted = false;
      let noChangeRequiresFreshCapture = false;
      let noChangeCorrectionError: string | null = null;
      let noChangeResult: Awaited<ReturnType<typeof persistConvergedStructure>> = null;
      if (hasNoApplicableChanges) {
        const persistence = await runPreparedStructuralPersistence(
          () => execution.transition({ type: 'persisting_structure' }),
          outcome => {
            const requiresFreshCapture = outcome.kind === 'requires_fresh_capture';
            noChangeResult = outcome.result;
            diff = outcome.commit.diff;
            hasUnresolvedConflicts = outcome.commit.structuralConflicts > 0;
            hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
            noChangePersistenceCompleted = true;
            if (requiresFreshCapture) {
              noChangeRequiresFreshCapture = true;
              noChangeCorrectionError = getRayenImportErrorMessage(outcome.error);
            }
            return continueClinicalAfterCommit(outcome.commit);
          }
        );
        if (persistence.kind !== 'committed') return;
      }
      const isExecutionDateVisible =
        !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
      setState(previous =>
        !isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)
          ? previous
          : isExecutionDateVisible
            ? {
                diff,
                isPreviewOpen: shouldOpenRayenSnapshotPreview({
                  persistenceCompleted: noChangePersistenceCompleted,
                  hasUnresolvedConflicts,
                  hasNoApplicableChanges,
                }),
                isBusy: false,
                isSyncing: noChangePersistenceCompleted ? false : hasNoApplicableChanges,
                result: noChangePersistenceCompleted ? noChangeResult : null,
                hasSkippedItems: noChangeResult
                  ? noChangeResult.skipped.length > 0 ||
                    noChangeResult.historicalCorrectionsPending ||
                    noChangeRequiresFreshCapture
                  : false,
                error:
                  noChangeCorrectionError ??
                  (!noChangePersistenceCompleted && run.policy?.mode === 'auto' && needsReview
                    ? 'El modo automático requiere revisión: hay conflictos, altas administrativas pendientes o correcciones de días previos.'
                    : null),
              }
            : { ...previous, isBusy: false }
      );
      if (!noChangePersistenceCompleted) {
        const reviewStage = resolveRayenSnapshotPlanningStage(
          hasNoApplicableChanges,
          hasUnresolvedConflicts
        );
        const replan = structuralReplanRef.current;
        if (
          (reviewStage.type === 'awaiting_review' || reviewStage.type === 'needs_review') &&
          matchesRayenStructuralReplan(replan, executionIdentity)
        ) {
          structuralReplanRef.current = startRayenStructuralReviewTiming(replan, monotonicNow);
        }
        execution.transition(reviewStage);
      }
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
