import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_RAYEN_IMPORT_STATE,
  type RayenImportState,
} from '@/features/rayen-import/hooks/rayenImportState';
import { useRayenSyncExecutionController } from '@/features/rayen-import/hooks/useRayenSyncExecutionController';

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
      result.current.controller.finishClinicalSync({ status: 'complete' }, 'run-old');
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
    act(() => {
      expect(result.current.controller.startClinicalRetry('persisted-run', '2026-08-08')).toBe(
        true
      );
      result.current.controller.finishClinicalSync({ status: 'complete' }, 'persisted-run');
    });

    expect(result.current.importState.isSyncing).toBe(false);
    expect(result.current.controller.execution.pending).toEqual({
      runId: 'persisted-run',
      selectedDate: '2026-08-08',
    });
    expect(result.current.controller.execution.stage).toEqual({ type: 'complete' });
  });

  it('settles a partial clinical result as a clinical-only retry', () => {
    const { result } = renderHook(useControllerHarness);
    act(() => {
      expect(result.current.controller.startClinicalRetry('partial-run', '2026-08-08')).toBe(true);
      result.current.controller.finishClinicalSync(
        {
          status: 'partial',
          retry: {
            type: 'clinical_retry',
            source: {} as never,
            pendingClinicalEpisodeIds: ['episode-1'],
          },
        },
        'partial-run'
      );
    });

    expect(result.current.importState.isSyncing).toBe(false);
    expect(result.current.controller.execution.stage).toEqual({
      type: 'partial',
      retry: 'clinical_only',
    });
  });

  it('settles an unretryable clinical failure as failed', () => {
    const { result } = renderHook(useControllerHarness);
    act(() => {
      expect(result.current.controller.startClinicalRetry('failed-run', '2026-08-08')).toBe(true);
      result.current.controller.finishClinicalSync({ status: 'failed' }, 'failed-run');
    });

    expect(result.current.importState.isSyncing).toBe(false);
    expect(result.current.controller.execution.stage).toEqual({ type: 'failed' });
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

  it('promotes same-tick skipped settlement into the canonical terminal outcome', () => {
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
      result.current.controller.finishClinicalSync({ status: 'complete' }, 'run-current');
    });

    expect(result.current.importState.isSyncing).toBe(false);
    expect(result.current.importState.hasSkippedItems).toBe(true);
    expect(result.current.controller.execution.outcome).toEqual({
      structuralConflicts: 0,
      skippedItems: 1,
    });
    expect(result.current.controller.execution.stage).toEqual({
      type: 'needs_review',
      scope: 'post_commit',
    });
  });

  it('keeps hidden structural review facts when another date replaces the visible state', () => {
    const { result } = renderHook(useControllerHarness);
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
      result.current.controller.transitionExecution({ type: 'syncing_clinical' }, 'run-old-date');
      result.current.controller.setImportStateCurrent(previous => ({
        ...previous,
        diff: null,
        result: null,
        hasSkippedItems: false,
      }));
      result.current.controller.finishClinicalSync({ status: 'complete' }, 'run-old-date');
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
