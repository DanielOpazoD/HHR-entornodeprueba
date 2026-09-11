import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  INITIAL_RAYEN_IMPORT_STATE,
  type RayenImportState,
} from '@/features/rayen-import/hooks/rayenImportState';
import {
  RAYEN_SYNC_STAGE_TRANSITIONS,
  isRayenSyncExecutionCurrent,
  isRayenSyncStageTransitionAllowed,
  rayenSyncExecutionReducer,
  type RayenSyncStage,
} from '@/features/rayen-import/hooks/rayenSyncExecutionState';
import { useRayenSyncExecutionController } from '@/features/rayen-import/hooks/useRayenSyncExecutionController';
import { createActiveExecutionHarness, createExecutionHarness } from './support/executionHarness';

const reportRayenSyncWarning = vi.hoisted(() => vi.fn());
vi.mock('@/features/rayen-import/observability/rayenSyncDiagnostics', () => ({
  reportRayenSyncWarning,
}));

const identity = { runId: 'run-1', requestId: 'request-1', selectedDate: '2026-08-02' };

describe('sync execution transition graph', () => {
  it('is forward-only: every settled stage is a sink and no edge points back before the commit', () => {
    for (const stage of [
      'complete',
      'partial',
      'failed',
      'cancelled',
      'needs_review:post_commit',
    ]) {
      expect(
        RAYEN_SYNC_STAGE_TRANSITIONS[stage as keyof typeof RAYEN_SYNC_STAGE_TRANSITIONS]
      ).toEqual([]);
    }
    const postCommit = ['verifying_structure', 'syncing_clinical'] as const;
    const preCommit = [
      'capturing',
      'planning_structure',
      'awaiting_review',
      'persisting_structure',
    ];
    for (const from of postCommit) {
      for (const to of RAYEN_SYNC_STAGE_TRANSITIONS[from]) {
        expect(preCommit).not.toContain(to);
      }
    }
  });

  it('drops a late callback that tries to re-enter an earlier stage and keeps the current one', () => {
    const { executionRef, dispatchExecution } = createActiveExecutionHarness();
    for (const stage of [
      { type: 'planning_structure' },
      { type: 'persisting_structure' },
      { type: 'verifying_structure' },
      { type: 'syncing_clinical' },
    ] as const) {
      dispatchExecution({ type: 'transition', ...identity, stage });
    }
    const clinical = executionRef.current;

    dispatchExecution({ type: 'transition', ...identity, stage: { type: 'planning_structure' } });
    expect(executionRef.current).toBe(clinical);
    dispatchExecution({ type: 'transition', ...identity, stage: { type: 'awaiting_review' } });
    expect(executionRef.current).toBe(clinical);
    expect(executionRef.current.stage).toEqual({ type: 'syncing_clinical' });
  });

  it('refuses to start clinical work before the structural commit was verified', () => {
    const { executionRef, dispatchExecution } = createActiveExecutionHarness();
    dispatchExecution({ type: 'transition', ...identity, stage: { type: 'planning_structure' } });
    dispatchExecution({ type: 'transition', ...identity, stage: { type: 'awaiting_review' } });
    const reviewing = executionRef.current;

    dispatchExecution({ type: 'transition', ...identity, stage: { type: 'syncing_clinical' } });
    expect(executionRef.current).toBe(reviewing);
    expect(
      isRayenSyncStageTransitionAllowed({ type: 'awaiting_review' }, { type: 'syncing_clinical' })
    ).toBe(false);
  });

  it('keeps the two legitimate detours: clinical-only retry and structural re-plan', () => {
    // Retry: a pending execution goes straight to the clinical stage.
    const retry = createExecutionHarness();
    retry.dispatchExecution({ type: 'prepare', runId: 'run-2', selectedDate: '2026-08-02' });
    retry.dispatchExecution({
      type: 'transition',
      runId: 'run-2',
      selectedDate: '2026-08-02',
      stage: { type: 'syncing_clinical' },
    });
    expect(retry.executionRef.current.stage).toEqual({ type: 'syncing_clinical' });

    // Re-plan: the CAS lost, the reviewed plan changed, and the operator must look again.
    const replan: Array<[RayenSyncStage, RayenSyncStage]> = [
      [{ type: 'persisting_structure' }, { type: 'awaiting_review' }],
      [{ type: 'persisting_structure' }, { type: 'needs_review', scope: 'structure' }],
      [{ type: 'needs_review', scope: 'structure' }, { type: 'awaiting_review' }],
    ];
    for (const [from, to] of replan) {
      expect(isRayenSyncStageTransitionAllowed(from, to)).toBe(true);
    }
  });

  it('treats a missing execution guard as stale instead of current', () => {
    expect(isRayenSyncExecutionCurrent(undefined, identity)).toBe(false);
    expect(isRayenSyncExecutionCurrent(null, identity)).toBe(false);
    const { executionRef } = createActiveExecutionHarness();
    expect(isRayenSyncExecutionCurrent(executionRef.current, identity)).toBe(true);
    expect(
      isRayenSyncExecutionCurrent(
        rayenSyncExecutionReducer(executionRef.current, { type: 'reset' }),
        identity
      )
    ).toBe(false);
  });
});

describe('controller diagnostics for refused transitions', () => {
  const useHarness = () => {
    const [importState, setImportState] = useState<RayenImportState>(INITIAL_RAYEN_IMPORT_STATE);
    return useRayenSyncExecutionController({ importState, setImportState });
  };

  it('reports a graph refusal once, with both stage names, and leaves the state untouched', () => {
    reportRayenSyncWarning.mockClear();
    const { result } = renderHook(useHarness);
    act(() => {
      result.current.dispatchExecution({
        type: 'prepare',
        runId: 'run-1',
        selectedDate: '2026-08-02',
      });
      result.current.transitionExecution({ type: 'syncing_clinical' }, 'run-1');
      result.current.transitionExecution({ type: 'capturing' }, 'run-1');
    });
    expect(result.current.execution.stage).toEqual({ type: 'syncing_clinical' });
    expect(reportRayenSyncWarning).toHaveBeenCalledWith('sync_stage_transition_rejected', {
      runId: 'run-1',
      from: 'syncing_clinical',
      to: 'capturing',
    });
    expect(reportRayenSyncWarning).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the refusal is about identity, not the graph', () => {
    reportRayenSyncWarning.mockClear();
    const { result } = renderHook(useHarness);
    act(() => {
      result.current.dispatchExecution({
        type: 'prepare',
        runId: 'run-1',
        selectedDate: '2026-08-02',
      });
      result.current.transitionExecution({ type: 'capturing' }, 'run-other');
    });
    expect(reportRayenSyncWarning).not.toHaveBeenCalled();
  });
});
