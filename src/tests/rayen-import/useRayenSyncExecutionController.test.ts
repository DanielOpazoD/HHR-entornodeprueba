import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_RAYEN_IMPORT_STATE,
  type RayenImportState,
} from '@/features/rayen-import/hooks/rayenImportState';
import { useRayenSyncExecutionController } from '@/features/rayen-import/hooks/useRayenSyncExecutionController';
import {
  beginRayenFill,
  endRayenFill,
  reportRayenFillProgress,
  resetRayenFillProgress,
} from '@/features/rayen-import/hooks/useRayenFillStatus';

const useControllerHarness = () => {
  const [importState, setImportState] = useState<RayenImportState>({
    ...INITIAL_RAYEN_IMPORT_STATE,
    isSyncing: true,
  });
  const controller = useRayenSyncExecutionController({ importState, setImportState });
  return { importState, controller };
};

describe('useRayenSyncExecutionController', () => {
  it('ignores clinical settlement from an execution superseded by a newer run', () => {
    const { result } = renderHook(useControllerHarness);

    act(() => {
      result.current.controller.dispatchExecution({
        type: 'prepare',
        runId: 'run-old',
        selectedDate: '2026-08-07',
      });
      result.current.controller.transitionExecution({ type: 'syncing_clinical' }, 'run-old');
      result.current.controller.dispatchExecution({
        type: 'prepare',
        runId: 'run-new',
        selectedDate: '2026-08-08',
      });
      result.current.controller.transitionExecution({ type: 'syncing_clinical' }, 'run-new');
      result.current.controller.finishClinicalSync('run-old');
    });

    expect(result.current.importState.isSyncing).toBe(true);
    expect(result.current.controller.execution.pending).toEqual({
      runId: 'run-new',
      selectedDate: '2026-08-08',
    });
    expect(result.current.controller.execution.stage).toEqual({ type: 'syncing_clinical' });
  });

  it('adopts and settles a persisted clinical-only retry after reload', () => {
    const { result } = renderHook(useControllerHarness);
    resetRayenFillProgress();
    beginRayenFill(1);
    reportRayenFillProgress(1, 1);
    endRayenFill(0);

    act(() => {
      expect(result.current.controller.startClinicalRetry('persisted-run', '2026-08-08')).toBe(
        true
      );
      result.current.controller.finishClinicalSync('persisted-run');
    });

    expect(result.current.importState.isSyncing).toBe(false);
    expect(result.current.controller.execution.pending).toEqual({
      runId: 'persisted-run',
      selectedDate: '2026-08-08',
    });
    expect(result.current.controller.execution.stage).toEqual({ type: 'complete' });
  });

  it('does not let a persisted retry replace a newer active execution', () => {
    const { result } = renderHook(useControllerHarness);

    act(() => {
      result.current.controller.dispatchExecution({
        type: 'prepare',
        runId: 'run-new',
        selectedDate: '2026-08-08',
      });
    });

    expect(result.current.controller.startClinicalRetry('persisted-run', '2026-08-07')).toBe(false);
    expect(result.current.controller.execution.pending).toEqual({
      runId: 'run-new',
      selectedDate: '2026-08-08',
    });
    expect(result.current.controller.execution.stage).toEqual({ type: 'preparing_context' });
  });

  it('classifies a same-tick clinical settlement from the latest import flags', () => {
    const { result } = renderHook(useControllerHarness);

    act(() => {
      result.current.controller.dispatchExecution({
        type: 'prepare',
        runId: 'run-current',
        selectedDate: '2026-08-08',
      });
      result.current.controller.transitionExecution({ type: 'syncing_clinical' }, 'run-current');
      result.current.controller.setImportStateCurrent(previous => ({
        ...previous,
        hasSkippedItems: true,
      }));
      result.current.controller.finishClinicalSync('run-current');
    });

    expect(result.current.importState.isSyncing).toBe(false);
    expect(result.current.importState.hasSkippedItems).toBe(true);
    expect(result.current.controller.execution.stage).toEqual({
      type: 'needs_review',
      scope: 'post_commit',
    });
  });

  it('keeps hidden structural review facts when another date replaces the visible state', () => {
    const { result } = renderHook(useControllerHarness);
    resetRayenFillProgress();
    beginRayenFill(1);
    reportRayenFillProgress(1, 1);
    endRayenFill(0);

    act(() => {
      result.current.controller.dispatchExecution({
        type: 'prepare',
        runId: 'run-old-date',
        selectedDate: '2026-08-07',
      });
      result.current.controller.dispatchExecution({
        type: 'record_outcome',
        runId: 'run-old-date',
        selectedDate: '2026-08-07',
        structuralConflicts: 1,
        skippedItems: 1,
      });
      result.current.controller.transitionExecution(
        { type: 'syncing_clinical' },
        'run-old-date'
      );
      result.current.controller.setImportStateCurrent(previous => ({
        ...previous,
        diff: null,
        result: null,
        hasSkippedItems: false,
      }));
      result.current.controller.finishClinicalSync('run-old-date');
    });

    expect(result.current.importState.hasSkippedItems).toBe(false);
    expect(result.current.controller.execution.outcome).toEqual({
      structuralConflicts: 1,
      skippedItems: 1,
    });
    expect(result.current.controller.execution.stage).toEqual({
      type: 'needs_review',
      scope: 'post_commit',
    });
  });
});
