import { describe, expect, it } from 'vitest';
import {
  INITIAL_RAYEN_SYNC_EXECUTION_STATE,
  matchesRayenSyncExecution,
  rayenSyncExecutionKey,
  rayenSyncExecutionReducer,
  releaseRayenSyncExecutionLock,
  isRayenSyncExecutionCancellableBeforeCommit,
  isRayenSyncExecutionSettled,
  isRayenSyncPreviewStage,
  type RayenSyncExecutionContext,
} from '@/features/rayen-import/hooks/rayenSyncExecutionState';

const context = (
  runId: string,
  requestId: string,
  selectedDate = '2026-08-07'
): RayenSyncExecutionContext => ({
  runId,
  requestId,
  selectedDate,
  clinicalDay: '2026-08-08',
  timeZone: 'Pacific/Easter',
  target: selectedDate === '2026-08-08' ? 'current' : 'historical',
  lookbackDays: selectedDate === '2026-08-08' ? 0 : 1,
  baseRevision: 'revision-1',
  policy: Object.freeze({ mode: 'preview', clinicalBatchMode: 'shadow', revision: 3 }),
  policyRevision: 3,
  queryRange: Object.freeze({ dateStart: selectedDate, dateEnd: '2026-08-09' }),
  preparedAt: '2026-08-08T18:00:00.000Z',
});

const activate = (execution: RayenSyncExecutionContext) =>
  rayenSyncExecutionReducer(
    rayenSyncExecutionReducer(INITIAL_RAYEN_SYNC_EXECUTION_STATE, {
      type: 'prepare',
      runId: execution.runId,
      selectedDate: execution.selectedDate,
    }),
    { type: 'activate', context: execution }
  );

describe('rayenSyncExecutionReducer', () => {
  it('advances one correlated execution through mutually exclusive stages', () => {
    const execution = context('run-1', 'request-1');
    const active = activate(execution);

    const planning = rayenSyncExecutionReducer(active, {
      type: 'transition',
      runId: execution.runId,
      requestId: execution.requestId,
      selectedDate: execution.selectedDate,
      stage: { type: 'planning_structure' },
    });

    expect(active.stage).toEqual({ type: 'capturing' });
    expect(planning.stage).toEqual({ type: 'planning_structure' });
    expect(planning.context).toEqual(execution);
  });

  it('ignores a late response from a superseded request or selected date', () => {
    const latest = activate(context('run-new', 'request-new', '2026-08-08'));

    const stale = rayenSyncExecutionReducer(latest, {
      type: 'transition',
      runId: 'run-old',
      requestId: 'request-old',
      selectedDate: '2026-08-07',
      stage: { type: 'awaiting_review' },
    });

    expect(stale).toBe(latest);
    expect(stale.stage).toEqual({ type: 'capturing' });
  });

  it('does not revive a cancelled execution when its capture finishes late', () => {
    const execution = context('run-1', 'request-1');
    const active = activate(execution);
    const cancelled = rayenSyncExecutionReducer(active, { type: 'cancel', runId: execution.runId });

    const late = rayenSyncExecutionReducer(cancelled, {
      type: 'transition',
      runId: execution.runId,
      requestId: execution.requestId,
      selectedDate: execution.selectedDate,
      stage: { type: 'awaiting_review' },
    });

    expect(cancelled.stage).toEqual({ type: 'cancelled' });
    expect(late).toBe(cancelled);
    expect(
      matchesRayenSyncExecution(cancelled, {
        runId: execution.runId,
        requestId: execution.requestId,
        selectedDate: execution.selectedDate,
      })
    ).toBe(false);
  });

  it.each([
    { type: 'complete' } as const,
    { type: 'partial', retry: 'clinical_only' } as const,
    { type: 'failed' } as const,
  ])('does not revive a settled $type execution with a late callback', terminalStage => {
    const execution = context('run-1', 'request-1');
    const active = activate(execution);
    const settled = rayenSyncExecutionReducer(active, {
      type: 'transition',
      runId: execution.runId,
      requestId: execution.requestId,
      selectedDate: execution.selectedDate,
      stage: terminalStage,
    });

    const late = rayenSyncExecutionReducer(settled, {
      type: 'transition',
      runId: execution.runId,
      requestId: execution.requestId,
      selectedDate: execution.selectedDate,
      stage: { type: 'planning_structure' },
    });

    expect(late).toBe(settled);
    expect(late.stage).toEqual(terminalStage);
    expect(
      matchesRayenSyncExecution(settled, {
        runId: execution.runId,
        requestId: execution.requestId,
        selectedDate: execution.selectedDate,
      })
    ).toBe(false);
  });

  it('replaces an obsolete pending execution without inheriting its review state', () => {
    const old = activate(context('run-old', 'request-old'));
    const oldReview = rayenSyncExecutionReducer(old, {
      type: 'transition',
      runId: 'run-old',
      requestId: 'request-old',
      stage: { type: 'awaiting_review' },
    });

    const next = rayenSyncExecutionReducer(oldReview, {
      type: 'prepare',
      runId: 'run-new',
      selectedDate: '2026-08-08',
    });

    expect(next).toEqual({
      context: null,
      pending: { runId: 'run-new', selectedDate: '2026-08-08' },
      stage: { type: 'preparing_context' },
      outcome: { structuralConflicts: 0, skippedItems: 0 },
    });
  });

  it('keeps review facts correlated with the execution and resets them for the next run', () => {
    const execution = context('run-1', 'request-1');
    const active = activate(execution);
    const recorded = rayenSyncExecutionReducer(active, {
      type: 'record_outcome',
      runId: execution.runId,
      requestId: execution.requestId,
      selectedDate: execution.selectedDate,
      structuralConflicts: 2,
      skippedItems: 1,
    });

    expect(recorded.outcome).toEqual({ structuralConflicts: 2, skippedItems: 1 });

    const stale = rayenSyncExecutionReducer(recorded, {
      type: 'record_outcome',
      runId: 'run-old',
      structuralConflicts: 5,
    });
    expect(stale).toBe(recorded);

    const next = rayenSyncExecutionReducer(recorded, {
      type: 'prepare',
      runId: 'run-2',
      selectedDate: '2026-08-08',
    });
    expect(next.outcome).toEqual({ structuralConflicts: 0, skippedItems: 0 });
  });

  it('keeps a newer execution lock when an obsolete apply settles', () => {
    const oldKey = rayenSyncExecutionKey({
      runId: 'run-old',
      requestId: 'request-old',
      selectedDate: '2026-08-07',
    });
    const newKey = rayenSyncExecutionKey({
      runId: 'run-new',
      requestId: 'request-new',
      selectedDate: '2026-08-08',
    });

    expect(oldKey).not.toBe(newKey);
    expect(releaseRayenSyncExecutionLock(newKey, oldKey)).toBe(newKey);
    expect(releaseRayenSyncExecutionLock(newKey, newKey)).toBeNull();
  });

  it.each(['syncing_clinical', 'failed'] as const)(
    'keeps current-run review or error content visible during %s',
    stage => {
      expect(isRayenSyncPreviewStage({ type: stage })).toBe(true);
    }
  );

  it.each(['preparing_context', 'capturing', 'planning_structure', 'awaiting_review'] as const)(
    'allows cancelling %s before the structural commit',
    stage => {
      expect(isRayenSyncExecutionCancellableBeforeCommit({ type: stage })).toBe(true);
    }
  );

  it.each(['persisting_structure', 'verifying_structure', 'syncing_clinical'] as const)(
    'keeps %s running after its presentation is dismissed',
    stage => {
      expect(isRayenSyncExecutionCancellableBeforeCommit({ type: stage })).toBe(false);
    }
  );

  it('distinguishes structural review from review after a confirmed handoff', () => {
    expect(
      isRayenSyncExecutionCancellableBeforeCommit({ type: 'needs_review', scope: 'structure' })
    ).toBe(true);
    expect(
      isRayenSyncExecutionCancellableBeforeCommit({ type: 'needs_review', scope: 'post_commit' })
    ).toBe(false);
    expect(isRayenSyncExecutionSettled({ type: 'needs_review', scope: 'post_commit' })).toBe(true);
  });
});
