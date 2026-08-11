import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { RayenImportState } from './rayenImportState';
import type { ClinicalStageResult } from '../contracts/clinicalStageResult';
import {
  INITIAL_RAYEN_SYNC_EXECUTION_STATE,
  isRayenSyncPreviewStage,
  isRayenSyncExecutionSettled,
  rayenSyncExecutionReducer,
  type RayenSyncExecutionAction,
  type RayenSyncStage,
} from './rayenSyncExecutionState';

interface UseRayenSyncExecutionControllerInput {
  importState: RayenImportState;
  setImportState: Dispatch<SetStateAction<RayenImportState>>;
}

/** Keeps execution identity and terminal clinical state in one correlated controller. */
export const useRayenSyncExecutionController = ({
  importState,
  setImportState,
}: UseRayenSyncExecutionControllerInput) => {
  const [execution, dispatchExecutionReducer] = useReducer(
    rayenSyncExecutionReducer,
    INITIAL_RAYEN_SYNC_EXECUTION_STATE
  );
  const executionRef = useRef(execution);
  const importStateRef = useRef(importState);
  const clinicalRunIdRef = useRef<string | null>(null);

  /**
   * Keep the imperative identity guard current in the same tick as the reducer dispatch.
   * Async capture callbacks must not wait for React's next render before seeing cancellation,
   * supersession or a newly selected date.
   */
  const dispatchExecution = useCallback((action: RayenSyncExecutionAction) => {
    const previousExecution = executionRef.current;
    const nextExecution = rayenSyncExecutionReducer(previousExecution, action);
    const actionWasAccepted = nextExecution !== previousExecution;

    if (
      action.type === 'transition' &&
      action.stage.type === 'syncing_clinical' &&
      actionWasAccepted
    ) {
      clinicalRunIdRef.current = action.runId;
    } else if (
      action.type === 'prepare' ||
      action.type === 'reset' ||
      (action.type === 'cancel' && actionWasAccepted)
    ) {
      clinicalRunIdRef.current = null;
    }

    executionRef.current = nextExecution;
    dispatchExecutionReducer(action);
  }, []);

  useEffect(() => {
    executionRef.current = execution;
    importStateRef.current = importState;
  }, [execution, importState]);

  /** Keep the legacy payload current for consumers that still render the reviewed diff. */
  const setImportStateCurrent = useCallback<Dispatch<SetStateAction<RayenImportState>>>(
    update => {
      const next = typeof update === 'function' ? update(importStateRef.current) : update;
      importStateRef.current = next;
      setImportState(next);
    },
    [setImportState]
  );

  const transitionExecution = useCallback(
    (stage: RayenSyncStage, runId?: string) => {
      const { context, pending } = executionRef.current;
      const effectiveRunId = runId ?? context?.runId ?? pending?.runId;
      if (!effectiveRunId) return;
      dispatchExecution({
        type: 'transition',
        runId: effectiveRunId,
        requestId: context?.requestId,
        selectedDate: context?.selectedDate ?? pending?.selectedDate,
        stage,
      });
    },
    [dispatchExecution]
  );

  const startClinicalRetry = useCallback(
    (runId: string, selectedDate: string): boolean => {
      const current = executionRef.current;
      const activeRunId = current.context?.runId ?? current.pending?.runId;
      if (activeRunId && activeRunId !== runId && !isRayenSyncExecutionSettled(current.stage)) {
        return false;
      }
      if (activeRunId !== runId || isRayenSyncExecutionSettled(current.stage)) {
        dispatchExecution({ type: 'prepare', runId, selectedDate });
      }
      dispatchExecution({
        type: 'transition',
        runId,
        selectedDate,
        stage: { type: 'syncing_clinical' },
      });
      return clinicalRunIdRef.current === runId;
    },
    [dispatchExecution]
  );

  const finishClinicalSync = useCallback(
    (result: ClinicalStageResult, runId?: string) => {
      const effectiveRunId = runId ?? clinicalRunIdRef.current;
      // A queue from an obsolete execution may drain after a newer run has started. It must not
      // clear the new run's progress or project a terminal result into its UI.
      if (!effectiveRunId || clinicalRunIdRef.current !== effectiveRunId) return;
      clinicalRunIdRef.current = null;
      const importSettlement = importStateRef.current;
      const structuralConflicts = Math.max(
        importSettlement.diff?.conflicts.length ?? 0,
        importSettlement.diff?.summary.conflicts ?? 0
      );
      const skippedItems = Math.max(
        importSettlement.result?.skipped.length ?? 0,
        Number(importSettlement.hasSkippedItems)
      );

      // Some structural paths settle the clinical queue in the same tick as the reviewed diff.
      // Promote those facts into the canonical execution before choosing a terminal stage so a
      // partial import can never be presented as complete because React has not rendered yet.
      dispatchExecution({
        type: 'record_outcome',
        runId: effectiveRunId,
        structuralConflicts,
        skippedItems,
      });
      setImportStateCurrent(previous =>
        previous.isSyncing ? { ...previous, isSyncing: false } : previous
      );
      if (
        executionRef.current.outcome.structuralConflicts > 0 ||
        executionRef.current.outcome.skippedItems > 0
      ) {
        transitionExecution({ type: 'needs_review', scope: 'post_commit' }, effectiveRunId);
        return;
      }
      if (result.status === 'complete') {
        transitionExecution({ type: 'complete' }, effectiveRunId);
        return;
      }
      if (result.status === 'partial' || result.retry) {
        transitionExecution({ type: 'partial', retry: 'clinical_only' }, effectiveRunId);
        return;
      }
      transitionExecution({ type: 'failed' }, effectiveRunId);
    },
    [dispatchExecution, setImportStateCurrent, transitionExecution]
  );

  return {
    execution,
    executionRef,
    keepsPreviewOpen: isRayenSyncPreviewStage(execution.stage),
    dispatchExecution,
    setImportStateCurrent,
    transitionExecution,
    startClinicalRetry,
    finishClinicalSync,
  };
};
