import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLINICAL_FILL_TIMEOUT_MESSAGE,
  RAYEN_CLINICAL_STAGE_TIMEOUT_MS,
  createClinicalFillWatchdog,
} from '@/features/rayen-import/domain/clinicalFillWatchdog';
import { createConcurrencyGate } from '@/features/rayen-import/domain/concurrencyGate';
import {
  classifyRayenSyncError,
  classifyRayenSyncIssueReason,
} from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import {
  RAYEN_FILL_STALE_AFTER_MS,
  beginRayenFill,
  endRayenFill,
  registerRayenFillAbort,
  resetRayenFillProgress,
} from '@/features/rayen-import/hooks/useRayenFillStatus';
import {
  STRUCTURAL_PERSIST_TIMEOUT_MESSAGE,
  runRayenStructuralPersistenceLifecycle,
} from '@/features/rayen-import/hooks/rayenSnapshotPersistenceExecution';

/**
 * Techo de tiempo real para las etapas que no lo tenían. Antes, una promesa perdida dejaba la
 * sincronización en «Datos clínicos» hasta que el candado de 8 minutos liberaba el botón, sin
 * detener al worker; y el guardado estructural podía quedarse en «Guardando cambios» sin fin.
 */

describe('clinical fill watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetRayenFillProgress(Date.now() + RAYEN_FILL_STALE_AFTER_MS * 2);
  });

  it('aborts the stage after the ceiling and reports a timeout, never a concurrency conflict', () => {
    const onTimeout = vi.fn();
    const watchdog = createClinicalFillWatchdog({ onTimeout });

    vi.advanceTimersByTime(RAYEN_CLINICAL_STAGE_TIMEOUT_MS - 1);
    expect(watchdog.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);

    expect(watchdog.signal.aborted).toBe(true);
    expect(onTimeout).toHaveBeenCalledOnce();
    const reason = watchdog.signal.reason as Error;
    expect(reason.message).toBe(CLINICAL_FILL_TIMEOUT_MESSAGE);
    expect(classifyRayenSyncError(reason)).toBe('timeout');
    expect(classifyRayenSyncIssueReason('devices', reason)).toBe('source_timeout');
  });

  it('settle() disarms the timer and abort() is idempotent', () => {
    const onTimeout = vi.fn();
    const watchdog = createClinicalFillWatchdog({ timeoutMs: 1_000, onTimeout });
    watchdog.settle();
    vi.advanceTimersByTime(5_000);
    expect(watchdog.signal.aborted).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();

    watchdog.abort();
    watchdog.abort();
    expect(watchdog.signal.aborted).toBe(true);
  });

  it('closes the concurrency gate for reads queued behind it once aborted', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    const gate = createConcurrencyGate(1, controller.signal);
    let releaseFirst: (() => void) | null = null;
    const first = gate(
      () => new Promise<string>(resolve => (releaseFirst = () => resolve('first')))
    );
    const second = gate(async () => 'second');
    // Let the first operation acquire its slot before the stage is called off.
    await vi.waitFor(() => expect(releaseFirst).not.toBeNull());

    controller.abort(new Error('Clinical stage timeout'));
    releaseFirst!();

    await expect(first).resolves.toBe('first');
    await expect(second).rejects.toThrow('Clinical stage timeout');
  });

  it('lets the stale single-flight lock stop the worker instead of only freeing the button', () => {
    vi.useRealTimers();
    const t0 = 1_000_000;
    const abort = vi.fn();
    expect(beginRayenFill(3, t0)).toBe(true);
    registerRayenFillAbort(abort);

    expect(beginRayenFill(3, t0 + RAYEN_FILL_STALE_AFTER_MS - 1)).toBe(false);
    expect(abort).not.toHaveBeenCalled();

    expect(beginRayenFill(3, t0 + RAYEN_FILL_STALE_AFTER_MS + 1)).toBe(true);
    expect(abort).toHaveBeenCalledOnce();
    endRayenFill(0);
  });
});

describe('structural persistence watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails the run with a timeout when the structural write never settles', async () => {
    const finishFailedPersistence = vi.fn();
    const continueAfterCommit = vi.fn();
    const pending = runRayenStructuralPersistenceLifecycle({
      executionKey: 'run-hang',
      activeExecutionKeys: new Set(),
      isCurrent: () => true,
      startPersistence: vi.fn(),
      persist: (() => new Promise(() => undefined)) as never,
      continueAfterCommit,
      finishFailedPersistence,
      persistTimeoutMs: 2_000,
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ kind: 'failed' });
    expect(continueAfterCommit).not.toHaveBeenCalled();
    const error = finishFailedPersistence.mock.calls[0]?.[0] as Error;
    expect(error.message).toBe(STRUCTURAL_PERSIST_TIMEOUT_MESSAGE);
    expect(classifyRayenSyncError(error)).toBe('timeout');
  });
});
