import {
  INITIAL_RAYEN_SYNC_EXECUTION_STATE,
  RAYEN_SYNC_TIME_ZONE,
  rayenSyncExecutionReducer,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionContext,
  type RayenSyncExecutionState,
  type RayenSyncStage,
} from '@/features/rayen-import/hooks/rayenSyncExecutionState';
import type { RayenImportPolicy } from '@/features/rayen-import/settings/rayenImportSettings';

/**
 * A reducer-backed execution guard for hook tests. The production controller keeps the ref in
 * sync with every dispatch in the same tick; hooks now fail closed without a wired guard, so
 * tests must provide one instead of relying on "no ref means current".
 */
export const createExecutionHarness = (
  initial: RayenSyncExecutionState = INITIAL_RAYEN_SYNC_EXECUTION_STATE
) => {
  const executionRef: { current: RayenSyncExecutionState } = { current: initial };
  const dispatchExecution = (action: RayenSyncExecutionAction) => {
    executionRef.current = rayenSyncExecutionReducer(executionRef.current, action);
  };
  return { executionRef, dispatchExecution };
};

const contextFor = (
  runId: string,
  requestId: string,
  selectedDate: string
): RayenSyncExecutionContext => ({
  runId,
  requestId,
  selectedDate,
  clinicalDay: selectedDate,
  timeZone: RAYEN_SYNC_TIME_ZONE,
  target: 'current',
  lookbackDays: 0,
  baseRevision: 'rev-1',
  policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 } as RayenImportPolicy,
  policyRevision: 1,
  queryRange: { dateStart: selectedDate, dateEnd: selectedDate },
  preparedAt: `${selectedDate}T10:00:00.000Z`,
});

/** A guard whose run is already capturing (the extension request is in flight). */
export const createActiveExecutionHarness = (
  runId = 'run-1',
  requestId = 'request-1',
  selectedDate = '2026-08-02'
) => {
  const harness = createExecutionHarness();
  harness.dispatchExecution({ type: 'prepare', runId, selectedDate });
  harness.dispatchExecution({
    type: 'activate',
    context: contextFor(runId, requestId, selectedDate),
  });
  return harness;
};

/** A guard whose previous run settled through the real path (clinical stage → terminal). */
export const settledExecutionState = (
  runId: string,
  selectedDate: string,
  terminal: RayenSyncStage = { type: 'complete' }
): RayenSyncExecutionState => {
  const harness = createExecutionHarness();
  harness.dispatchExecution({ type: 'prepare', runId, selectedDate });
  harness.dispatchExecution({
    type: 'transition',
    runId,
    selectedDate,
    stage: { type: 'syncing_clinical' },
  });
  harness.dispatchExecution({ type: 'transition', runId, selectedDate, stage: terminal });
  return harness.executionRef.current;
};
