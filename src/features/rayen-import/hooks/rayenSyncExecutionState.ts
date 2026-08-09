import type { RayenImportPolicy } from '../settings/rayenImportSettings';

export const RAYEN_SYNC_TIME_ZONE = 'Pacific/Easter' as const;

export type RayenSyncStage =
  | { type: 'preparing_context' }
  | { type: 'capturing' }
  | { type: 'planning_structure' }
  | { type: 'awaiting_review' }
  | { type: 'persisting_structure' }
  | { type: 'verifying_structure' }
  | { type: 'syncing_clinical' }
  | { type: 'complete' }
  | { type: 'partial'; retry: 'clinical_only' }
  | { type: 'needs_review'; scope: 'structure' | 'post_commit' }
  | { type: 'failed' }
  | { type: 'cancelled' };

export interface RayenSyncExecutionContext {
  runId: string;
  requestId: string;
  selectedDate: string;
  clinicalDay: string;
  timeZone: typeof RAYEN_SYNC_TIME_ZONE;
  target: 'current' | 'historical';
  lookbackDays: number;
  /** Firestore uses an opaque CAS token rather than a numeric revision. */
  baseRevision: string;
  policy: Readonly<RayenImportPolicy>;
  policyRevision: number;
  queryRange: Readonly<{ dateStart: string; dateEnd: string }>;
  preparedAt: string;
}

export interface PendingRayenSyncExecution {
  runId: string;
  selectedDate: string;
}

export interface RayenSyncExecutionIdentity {
  runId: string;
  requestId?: string;
  selectedDate?: string;
}

export interface RayenSyncExecutionOutcome {
  structuralConflicts: number;
  skippedItems: number;
}

export interface RayenSyncExecutionState {
  context: RayenSyncExecutionContext | null;
  pending: PendingRayenSyncExecution | null;
  stage: RayenSyncStage | null;
  outcome: RayenSyncExecutionOutcome;
}

export const rayenSyncExecutionIdentity = (
  state: RayenSyncExecutionState,
  runId?: string
): RayenSyncExecutionIdentity | null => {
  if (state.context && (!runId || state.context.runId === runId)) {
    return {
      runId: state.context.runId,
      requestId: state.context.requestId,
      selectedDate: state.context.selectedDate,
    };
  }
  if (state.pending && (!runId || state.pending.runId === runId)) {
    return { runId: state.pending.runId, selectedDate: state.pending.selectedDate };
  }
  return null;
};

export const rayenSyncExecutionKey = (identity: RayenSyncExecutionIdentity): string =>
  [identity.runId, identity.requestId ?? '', identity.selectedDate ?? ''].join(':');

/** An obsolete completion must never release a lock already claimed by a newer execution. */
export const releaseRayenSyncExecutionLock = (
  activeKey: string | null,
  completedKey: string
): string | null => (activeKey === completedKey ? null : activeKey);

export const INITIAL_RAYEN_SYNC_EXECUTION_STATE: RayenSyncExecutionState = Object.freeze({
  context: null,
  pending: null,
  stage: null,
  outcome: Object.freeze({ structuralConflicts: 0, skippedItems: 0 }),
});

export type RayenSyncExecutionAction =
  | { type: 'prepare'; runId: string; selectedDate: string }
  | { type: 'activate'; context: RayenSyncExecutionContext }
  | {
      type: 'transition';
      runId: string;
      requestId?: string;
      selectedDate?: string;
      stage: RayenSyncStage;
    }
  | {
      type: 'record_outcome';
      runId: string;
      requestId?: string;
      selectedDate?: string;
      structuralConflicts?: number;
      skippedItems?: number;
    }
  | { type: 'cancel'; runId?: string }
  | { type: 'reset' };

export const isRayenSyncExecutionSettled = (stage: RayenSyncStage | null): boolean =>
  !stage ||
  stage.type === 'complete' ||
  stage.type === 'partial' ||
  stage.type === 'failed' ||
  stage.type === 'cancelled' ||
  (stage.type === 'needs_review' && stage.scope === 'post_commit');

export const matchesRayenSyncExecution = (
  state: RayenSyncExecutionState,
  identity: RayenSyncExecutionIdentity
): boolean => {
  // A settled execution is immutable. Late callbacks from its own request are just as stale as
  // callbacks from a superseded request and must not revive persistence or clinical work.
  if (isRayenSyncExecutionSettled(state.stage)) return false;
  if (state.context) {
    return (
      state.context.runId === identity.runId &&
      (!identity.requestId || state.context.requestId === identity.requestId) &&
      (!identity.selectedDate || state.context.selectedDate === identity.selectedDate)
    );
  }
  return (
    state.pending?.runId === identity.runId &&
    !identity.requestId &&
    (!identity.selectedDate || state.pending.selectedDate === identity.selectedDate)
  );
};

/** Optional state keeps isolated legacy hook tests compatible; production always supplies it. */
export const isRayenSyncExecutionCurrent = (
  state: RayenSyncExecutionState | null | undefined,
  identity: RayenSyncExecutionIdentity
): boolean => !state || matchesRayenSyncExecution(state, identity);

/**
 * Canonical in-memory state for one Eloisa synchronization.
 *
 * Every asynchronous transition carries the execution identity. Superseded, cancelled or
 * cross-day callbacks therefore become inert instead of reviving an obsolete modal or status.
 */
export const rayenSyncExecutionReducer = (
  state: RayenSyncExecutionState,
  action: RayenSyncExecutionAction
): RayenSyncExecutionState => {
  switch (action.type) {
    case 'prepare':
      return {
        context: null,
        pending: { runId: action.runId, selectedDate: action.selectedDate },
        stage: { type: 'preparing_context' },
        outcome: { structuralConflicts: 0, skippedItems: 0 },
      };
    case 'activate':
      if (
        state.stage?.type === 'cancelled' ||
        state.pending?.runId !== action.context.runId ||
        state.pending.selectedDate !== action.context.selectedDate
      ) {
        return state;
      }
      return {
        context: action.context,
        pending: state.pending,
        stage: { type: 'capturing' },
        outcome: state.outcome,
      };
    case 'transition':
      return matchesRayenSyncExecution(state, action) ? { ...state, stage: action.stage } : state;
    case 'record_outcome':
      if (!matchesRayenSyncExecution(state, action)) return state;
      return {
        ...state,
        outcome: {
          structuralConflicts: Math.max(
            state.outcome.structuralConflicts,
            action.structuralConflicts ?? 0
          ),
          skippedItems: Math.max(state.outcome.skippedItems, action.skippedItems ?? 0),
        },
      };
    case 'cancel':
      if (
        action.runId &&
        state.context?.runId !== action.runId &&
        state.pending?.runId !== action.runId
      ) {
        return state;
      }
      return state.stage
        ? {
            ...state,
            stage: { type: 'cancelled' },
          }
        : state;
    case 'reset':
      return INITIAL_RAYEN_SYNC_EXECUTION_STATE;
  }
};

export const rayenSyncExecutionDate = (state: RayenSyncExecutionState): string | null =>
  state.context?.selectedDate ?? state.pending?.selectedDate ?? null;

export const isRayenSyncExecutionActive = (stage: RayenSyncStage | null): boolean =>
  stage?.type === 'preparing_context' ||
  stage?.type === 'capturing' ||
  stage?.type === 'planning_structure' ||
  stage?.type === 'persisting_structure' ||
  stage?.type === 'verifying_structure' ||
  stage?.type === 'syncing_clinical';

/**
 * Only work that has not started the structural commit may be aborted by dismissing the view.
 * Once persistence begins, the domain execution must converge even if the user changes the
 * selected day or closes its modal.
 */
export const isRayenSyncExecutionCancellableBeforeCommit = (
  stage: RayenSyncStage | null
): boolean =>
  stage?.type === 'preparing_context' ||
  stage?.type === 'capturing' ||
  stage?.type === 'planning_structure' ||
  stage?.type === 'awaiting_review' ||
  (stage?.type === 'needs_review' && stage.scope === 'structure');

export const isRayenSyncReviewStage = (stage: RayenSyncStage | null): boolean =>
  stage?.type === 'awaiting_review' || stage?.type === 'needs_review';

export const isRayenSyncPreviewStage = (stage: RayenSyncStage | null): boolean =>
  isRayenSyncReviewStage(stage) ||
  stage?.type === 'persisting_structure' ||
  stage?.type === 'verifying_structure' ||
  stage?.type === 'syncing_clinical' ||
  stage?.type === 'failed';
