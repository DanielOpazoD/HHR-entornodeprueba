import { useCallback, useRef } from 'react';
import { requiresReview } from '../domain/reconcileCensus';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { getRayenImportErrorMessage } from './rayenImportState';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import { useTreatingPhysicianCatalogSync } from './useTreatingPhysicianCatalogSync';
import { buildRayenCapturePerformance } from '../domain/rayenSyncSourceQuality';
import { isRayenSyncExecutionCurrent, rayenSyncExecutionKey } from './rayenSyncExecutionState';
import { createRayenSnapshotExecutionReporter } from './rayenSnapshotExecutionReporter';
import {
  hasNoApplicableRayenStructuralChanges, resolveRayenSnapshotPlanningStage,
  shouldOpenRayenSnapshotPreview,
} from './rayenSnapshotPlanningDecision';
import type { UseRayenSnapshotPreviewInput } from './rayenSnapshotPreviewContracts';
import { applyConfirmedRayenImport, committedRayenImportResultFromError } from './confirmRayenImport';
import { prepareRayenStructuralPlan } from './prepareRayenStructuralPlan';
import { summarizeRayenStructuralCommit } from './rayenStructuralCommitOutcome';
import {
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
  runSerializedPersistence,
}: UseRayenSnapshotPreviewInput) => {
  const persistenceExecutionKeysRef = useRef(new Set<string>());
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
      const baseRecord = preparedContext.record;
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
      const reconciliationStartedAt = Date.now();
      let historicalEvidenceMs = 0;
      const counters = { requests: 0, cacheHits: 0, timeouts: 0 };
      const measureEvidence = async <T>(operation: () => Promise<T>): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await operation();
        } finally {
          historicalEvidenceMs += elapsedMilliseconds(startedAt);
        }
      };
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
        baseRecord,
        planningSnapshot,
        bundle,
        isHistoricalDay: evidence.isHistoricalDay,
        reportDate: evidence.reportDate,
        dailyRecord,
        isAdmin,
        counters,
        measureEvidence,
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
            reconciliation: elapsedMilliseconds(reconciliationStartedAt),
            historicalEvidence: historicalEvidenceMs,
          },
          counters,
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
            base: baseRecord,
            diff,
            dailyRecord,
            isAdmin,
            ensureRun,
            applyDiff,
            getFreshRecord: async () =>
              (await dailyRecord.getForDateWithMeta(baseRecord.date, true)).record,
            replanDiff,
            clinicalDay: preparedContext.target.clinicalDay,
            createId: () => crypto.randomUUID(),
            onRetry: () => recordRunPerformance({ counters: { retries: 1 } }, run.id),
          });
        });
      if (canAutoApply) {
        if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
        const autoApplyKey = rayenSyncExecutionKey(executionIdentity);
        if (persistenceExecutionKeysRef.current.has(autoApplyKey)) return;
        persistenceExecutionKeysRef.current.add(autoApplyKey);
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
        try {
          const result = await persistConvergedStructure();
          if (!result) return;
          const committed = summarizeRayenStructuralCommit(result, false);
          const isCurrent = isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity);
          if (isCurrent) {
            execution.recordOutcome({
              structuralConflicts: committed.structuralConflicts,
              skippedItems: committed.skippedItems,
            });
            preparedSyncContextRef.current = null;
            structuralReplanRef.current = null;
            setState(prev => ({
              ...prev,
              diff: committed.diff,
              isPreviewOpen: committed.structuralConflicts > 0,
              isBusy: false,
              result,
              hasSkippedItems: committed.hasSkippedItems,
            }));
            execution.transition({ type: 'verifying_structure' });
            execution.transition({ type: 'syncing_clinical' });
          }
          await runClinicalStage(committed.clinicalHandoff);
        } catch (error) {
          const committedResult = committedRayenImportResultFromError<
            Awaited<ReturnType<typeof applyDiff>>
          >(error);
          if (committedResult) {
            const committed = summarizeRayenStructuralCommit(committedResult, true);
            const isCurrent = isRayenSyncExecutionCurrent(
              executionRef?.current,
              executionIdentity
            );
            if (isCurrent) {
              execution.recordOutcome({
                structuralConflicts: committed.structuralConflicts,
                skippedItems: committed.skippedItems,
              });
              preparedSyncContextRef.current = null;
              structuralReplanRef.current = null;
              setState(prev => ({
                ...prev,
                diff: committed.diff,
                isPreviewOpen: true,
                isBusy: false,
                result: committedResult,
                hasSkippedItems: true,
                error: getRayenImportErrorMessage(error),
              }));
              execution.transition({ type: 'verifying_structure' });
              execution.transition({ type: 'syncing_clinical' });
            }
            await runClinicalStage(committed.clinicalHandoff);
            return;
          }
          if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
          if (returnReplanToReview(error)) return;
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
        } finally {
          persistenceExecutionKeysRef.current.delete(autoApplyKey);
        }
        return;
      }
      let hasUnresolvedConflicts = structuralConflictCount > 0;
      let hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
      let noChangePersistenceCompleted = false;
      let noChangeRequiresFreshCapture = false;
      let noChangeCorrectionError: string | null = null;
      let noChangeResult: Awaited<ReturnType<typeof persistConvergedStructure>> = null;
      if (hasNoApplicableChanges) {
        const noChangePersistenceKey = rayenSyncExecutionKey(executionIdentity);
        if (persistenceExecutionKeysRef.current.has(noChangePersistenceKey)) return;
        persistenceExecutionKeysRef.current.add(noChangePersistenceKey);
        try {
          if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
          execution.transition({ type: 'persisting_structure' });
          const result = await persistConvergedStructure();
          if (!result) return;
          const committed = summarizeRayenStructuralCommit(result, false);
          noChangeResult = result;
          diff = committed.diff;
          hasUnresolvedConflicts = committed.structuralConflicts > 0;
          hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
          noChangePersistenceCompleted = true;
          const isCurrent = isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity);
          if (isCurrent) {
            execution.transition({ type: 'verifying_structure' });
            preparedSyncContextRef.current = null;
            structuralReplanRef.current = null;
            execution.recordOutcome({
              structuralConflicts: committed.structuralConflicts,
              skippedItems: committed.skippedItems,
            });
            execution.transition({ type: 'syncing_clinical' });
          }
          await runClinicalStage(committed.clinicalHandoff);
        } catch (error) {
          const committedResult = committedRayenImportResultFromError<
            Awaited<ReturnType<typeof applyDiff>>
          >(error);
          if (committedResult) {
            const committed = summarizeRayenStructuralCommit(committedResult, true);
            noChangeResult = committedResult;
            diff = committed.diff;
            hasUnresolvedConflicts = committed.structuralConflicts > 0;
            hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
            noChangePersistenceCompleted = true;
            noChangeRequiresFreshCapture = true;
            noChangeCorrectionError = getRayenImportErrorMessage(error);
            const isCurrent = isRayenSyncExecutionCurrent(
              executionRef?.current,
              executionIdentity
            );
            if (isCurrent) {
              execution.transition({ type: 'verifying_structure' });
              preparedSyncContextRef.current = null;
              structuralReplanRef.current = null;
              execution.recordOutcome({
                structuralConflicts: committed.structuralConflicts,
                skippedItems: committed.skippedItems,
              });
              execution.transition({ type: 'syncing_clinical' });
            }
            await runClinicalStage(committed.clinicalHandoff);
          } else {
            if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
            if (returnReplanToReview(error)) return;
            execution.transition({ type: 'failed' });
            preparedSyncContextRef.current = null;
            structuralReplanRef.current = null;
            void failRun('apply_failed', run.id).catch(() => undefined);
            const isExecutionDateVisible =
              !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
            setState(prev => ({
              ...prev,
              isBusy: false,
              isSyncing: false,
              ...(isExecutionDateVisible ? { error: getRayenImportErrorMessage(error) } : {}),
            }));
            return;
          }
        } finally {
          persistenceExecutionKeysRef.current.delete(noChangePersistenceKey);
        }
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
                requiresFreshCapture: noChangeRequiresFreshCapture,
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
        execution.transition(
          resolveRayenSnapshotPlanningStage(hasNoApplicableChanges, hasUnresolvedConflicts)
        );
      }
    },
    [
      applyDiff, clearSyncTimeout, dailyRecord, dispatchExecution,
      ensureRun, executionRef, failRun, runClinicalStage,
      getRun, isAdmin, preparedSyncContextRef, prepareTreatingPhysicianSnapshot,
      recordRunPerformance, runSerializedPersistence, selectedDateRef,
      setState, structuralReplanRef,
    ]
  );
};
