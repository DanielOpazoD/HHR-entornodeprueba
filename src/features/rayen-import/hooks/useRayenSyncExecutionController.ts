import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { getRayenFillProgressSnapshot } from './useRayenFillStatus';
import type { RayenImportState } from './rayenImportState';
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

  /**
   * Mirror import state before React commits the render. A zero-work clinical queue can settle in
   * the same tick as the structural result; terminal classification must see those latest flags.
   */
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
    (runId?: string) => {
      const effectiveRunId = runId ?? clinicalRunIdRef.current;
      // A queue from an obsolete execution may drain after a newer run has started. It must not
      // clear the new run's progress or project a terminal result into its UI.
      if (!effectiveRunId || clinicalRunIdRef.current !== effectiveRunId) return;
      clinicalRunIdRef.current = null;
      setImportStateCurrent(previous =>
        previous.isSyncing ? { ...previous, isSyncing: false } : previous
      );
      const latest = importStateRef.current;
      if (
        executionRef.current.outcome.structuralConflicts > 0 ||
        executionRef.current.outcome.skippedItems > 0 ||
        latest.diff?.summary.conflicts ||
        latest.hasSkippedItems ||
        latest.result?.skipped.length
      ) {
        transitionExecution({ type: 'needs_review', scope: 'post_commit' }, effectiveRunId);
        return;
      }
      transitionExecution(
        getRayenFillProgressSnapshot().outcome === 'complete'
          ? { type: 'complete' }
          : { type: 'partial', retry: 'clinical_only' },
        effectiveRunId
      );
    },
    [setImportStateCurrent, transitionExecution]
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
