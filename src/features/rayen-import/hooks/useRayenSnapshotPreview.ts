import { useCallback, useRef } from 'react';
import { requiresReview } from '../domain/reconcileCensus';
import type { RayenCensusSnapshot, RayenSyncBundle } from '../contracts/rayenSnapshot';
import { getRayenImportErrorMessage } from './rayenImportState';
import { toIsoReportDate } from './reportDateHelpers';
import { elapsedMilliseconds } from '../domain/rayenSyncPerformance';
import { useTreatingPhysicianCatalogSync } from './useTreatingPhysicianCatalogSync';
import { buildRayenCapturePerformance } from '../domain/rayenSyncSourceQuality';
import { validatePreparedRayenSyncContextAtCompletion } from './rayenSyncTemporalContext';
import { isRayenSyncExecutionCurrent, rayenSyncExecutionKey } from './rayenSyncExecutionState';
import { createRayenSnapshotExecutionReporter } from './rayenSnapshotExecutionReporter';
import {
  hasNoApplicableRayenStructuralChanges,
  resolveRayenSnapshotPlanningStage,
} from './rayenSnapshotPlanningDecision';
import type { UseRayenSnapshotPreviewInput } from './rayenSnapshotPreviewContracts';
import {
  applyConfirmedRayenImport,
  isRayenStructuralPlanChangedError,
} from './confirmRayenImport';
import { prepareRayenStructuralPlan } from './prepareRayenStructuralPlan';
import { markRayenHistoricalCorrectionsPending } from './rayenCensusPersistenceGuard';

export const useRayenSnapshotPreview = ({
  dailyRecord,
  isAdmin,
  setState,
  dispatchExecution = () => undefined,
  executionRef,
  selectedDateRef,
  clearSyncTimeout,
  applyDiff,
  fillDevicesInBackground,
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
      const returnReplanToReview = (error: unknown): boolean => {
        if (!isRayenStructuralPlanChangedError(error)) return false;
        preparedSyncContextRef.current = {
          ...preparedContext,
          record: error.freshRecord,
        };
        execution.transition(
          error.replannedDiff.conflicts.length > 0
            ? { type: 'needs_review', scope: 'structure' }
            : { type: 'awaiting_review' }
        );
        setState({
          diff: error.replannedDiff,
          isPreviewOpen: true,
          isBusy: false,
          isSyncing: false,
          result: null,
          hasSkippedItems: false,
          error: error.message,
        });
        return true;
      };
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
      const reportDate = toIsoReportDate(baseRecord);
      const requestedTarget = preparedContext.target;
      const temporalValidation = validatePreparedRayenSyncContextAtCompletion(preparedContext);
      if (!temporalValidation.valid) {
        execution.transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id).catch(() => undefined);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error:
            temporalValidation.reason === 'clinical_day_changed'
              ? 'El turno de enfermería cambió durante la captura. Vuelve a sincronizar para usar un único corte temporal.'
              : 'Solo se puede reconciliar el censo vigente o uno de los siete días clínicos anteriores.',
        }));
        return;
      }
      const isHistoricalDay = requestedTarget.kind === 'historical';
      const reportRange = preparedContext.range;
      const bundleMatchesRequest =
        bundle.facilityId === snapshot.facilityId &&
        bundle.fichaMedicoCapturedAt === snapshot.capturedAt &&
        bundle.dateStart === reportRange.dateStart &&
        bundle.dateEnd === reportRange.dateEnd;
      if (!bundleMatchesRequest) {
        execution.transition({ type: 'failed' });
        preparedSyncContextRef.current = null;
        void failRun('apply_failed', run.id).catch(() => undefined);
        setState(prev => ({
          ...prev,
          isBusy: false,
          isSyncing: false,
          error:
            'La evidencia de Ficha Médico y Gestión de Camas no corresponde al mismo censo. Vuelve a sincronizar.',
        }));
        return;
      }
      const { diff, replanDiff } = await prepareRayenStructuralPlan({
        baseRecord,
        planningSnapshot,
        bundle,
        isHistoricalDay,
        reportDate,
        dailyRecord,
        isAdmin,
        counters,
        measureEvidence,
      });
      // Planning can span multiple network reads. Once another run/date supersedes this capture,
      // its diff must never reach persistence or revive the review UI.
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
          const appliedDiff = result.appliedDiff;
          const isCurrent = isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity);
          if (isCurrent) {
            execution.recordOutcome({
              structuralConflicts: Math.max(
                appliedDiff.conflicts.length,
                appliedDiff.summary.conflicts
              ),
              skippedItems:
                result.skipped.length + Number(result.historicalCorrectionsPending),
            });
            preparedSyncContextRef.current = null;
            structuralReplanRef.current = null;
            setState(prev => ({
              ...prev,
              diff: appliedDiff,
              isPreviewOpen: appliedDiff.summary.conflicts > 0,
              isBusy: false,
              result,
              hasSkippedItems:
                result.skipped.length > 0 || result.historicalCorrectionsPending,
            }));
            execution.transition({ type: 'verifying_structure' });
            execution.transition({ type: 'syncing_clinical' });
          }
          // The committed handoff must reach clinical enrichment even when its UI execution was
          // superseded. The clinical queue validates the original run before writing.
          const clinicalHandoff = result.historicalCorrectionsPending
            ? markRayenHistoricalCorrectionsPending(result.confirmedHandoff)
            : result.confirmedHandoff;
          void fillDevicesInBackground(clinicalHandoff);
        } catch (error) {
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
      let noChangeClinicalStarted = false;
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
          noChangeResult = result;
          diff = result.appliedDiff;
          hasUnresolvedConflicts = Math.max(diff.conflicts.length, diff.summary.conflicts) > 0;
          hasNoApplicableChanges = hasNoApplicableRayenStructuralChanges(diff);
          noChangePersistenceCompleted = true;
          const isCurrent = isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity);
          if (isCurrent) {
            execution.transition({ type: 'verifying_structure' });
            preparedSyncContextRef.current = null;
            structuralReplanRef.current = null;
            execution.recordOutcome({
              structuralConflicts: Math.max(diff.conflicts.length, diff.summary.conflicts),
              skippedItems:
                result.skipped.length + Number(result.historicalCorrectionsPending),
            });
            execution.transition({ type: 'syncing_clinical' });
          }
          noChangeClinicalStarted = true;
          const clinicalHandoff = result.historicalCorrectionsPending
            ? markRayenHistoricalCorrectionsPending(result.confirmedHandoff)
            : result.confirmedHandoff;
          void fillDevicesInBackground(clinicalHandoff);
        } catch (error) {
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
        } finally {
          persistenceExecutionKeysRef.current.delete(noChangePersistenceKey);
        }
      }
      if (!isRayenSyncExecutionCurrent(executionRef?.current, executionIdentity)) return;
      const isExecutionDateVisible =
        !selectedDateRef || selectedDateRef.current === executionIdentity.selectedDate;
      setState(previous =>
        isExecutionDateVisible
          ? {
              diff,
              isPreviewOpen: noChangePersistenceCompleted
                ? hasUnresolvedConflicts
                : !hasNoApplicableChanges || hasUnresolvedConflicts,
              isBusy: false,
              isSyncing: noChangePersistenceCompleted
                ? noChangeClinicalStarted
                : hasNoApplicableChanges,
              result: noChangePersistenceCompleted ? noChangeResult : null,
              hasSkippedItems: noChangeResult
                ? noChangeResult.skipped.length > 0 ||
                  noChangeResult.historicalCorrectionsPending
                : false,
              error:
                !noChangePersistenceCompleted && run.policy?.mode === 'auto' && needsReview
                  ? 'El modo automático requiere revisión: hay conflictos, altas administrativas pendientes o correcciones de días previos.'
                  : null,
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
      applyDiff,
      dispatchExecution,
      executionRef,
      selectedDateRef,
      fillDevicesInBackground,
      clearSyncTimeout,
      dailyRecord,
      isAdmin,
      failRun,
      ensureRun,
      getRun,
      recordRunPerformance,
      runSerializedPersistence,
      setState,
      preparedSyncContextRef,
      structuralReplanRef,
      prepareTreatingPhysicianSnapshot,
    ]
  );
};
