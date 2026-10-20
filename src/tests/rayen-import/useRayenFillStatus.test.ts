import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  beginRayenFill,
  getRayenFillAttemptId,
  registerRayenFillAbort,
  getRayenFillProgressSnapshot,
  endRayenFill,
  RAYEN_FILL_STALE_AFTER_MS,
  invalidateRayenFillAttempt,
  isRayenFillAttemptCurrent,
  reportRayenFillProgress,
  reportRayenStaffingOutcome,
  resetRayenFillProgress,
  useRayenFillProgress,
} from '@/features/rayen-import/hooks/useRayenFillStatus';

describe('useRayenFillStatus attempt identity', () => {
  it('does not let an older fill completion hide a newer single-flight rejection', () => {
    const { result } = renderHook(() => useRayenFillProgress());

    act(() => {
      expect(beginRayenFill(4)).toBe(true);
      reportRayenFillProgress(2, 4, getRayenFillAttemptId());
    });
    expect(result.current).toMatchObject({
      running: true,
      outcome: 'running',
      attemptId: 1,
      done: 2,
    });

    act(() => {
      expect(beginRayenFill(4)).toBe(false);
    });
    expect(result.current).toMatchObject({
      running: true,
      outcome: 'rejected',
      attemptId: 2,
    });

    act(() => {
      expect(reportRayenStaffingOutcome('pending', 1)).toBe(false);
    });
    expect(result.current.staffingOutcome).toBe('idle');

    act(() => endRayenFill(3, true, 1));
    expect(result.current).toMatchObject({
      running: false,
      outcome: 'rejected',
      attemptId: 2,
      errors: 0,
      lastCompletedAt: null,
    });

    act(() => {
      expect(resetRayenFillProgress()).toBe(true);
    });
    expect(result.current).toMatchObject({
      running: false,
      outcome: 'idle',
      attemptId: 2,
      lastCompletedAt: null,
      staffingOutcome: 'idle',
    });
  });

  it('invalidates late staffing callbacks after the active flow is cancelled', () => {
    const { result } = renderHook(() => useRayenFillProgress());

    act(() => {
      expect(beginRayenFill(3)).toBe(true);
    });
    const cancelledAttemptId = result.current.attemptId;

    act(() => {
      expect(invalidateRayenFillAttempt()).toBe(true);
    });
    expect(result.current).toMatchObject({
      running: true,
      outcome: 'rejected',
      attemptId: cancelledAttemptId + 1,
      staffingOutcome: 'resolved',
    });
    expect(isRayenFillAttemptCurrent(cancelledAttemptId)).toBe(false);

    act(() => {
      expect(reportRayenStaffingOutcome('pending', cancelledAttemptId)).toBe(false);
      endRayenFill(0, false, cancelledAttemptId);
    });
    expect(result.current).toMatchObject({
      running: false,
      outcome: 'rejected',
      staffingOutcome: 'resolved',
    });

    act(() => {
      expect(resetRayenFillProgress()).toBe(true);
    });
  });

  it('keeps a global fill failure partial even when no patient-specific error exists', () => {
    const { result } = renderHook(() => useRayenFillProgress());

    act(() => {
      expect(beginRayenFill(3)).toBe(true);
      endRayenFill(0, true, getRayenFillAttemptId());
    });
    expect(result.current).toMatchObject({
      running: false,
      outcome: 'partial',
      errors: 0,
    });

    act(() => {
      expect(resetRayenFillProgress()).toBe(true);
    });
  });

  it('el vigilante libera un fill colgado más allá del techo y permite sincronizar de nuevo', () => {
    const { result } = renderHook(() => useRayenFillProgress());
    const t0 = 1_000_000;

    act(() => {
      expect(beginRayenFill(9, t0)).toBe(true);
    });
    // Dentro de la ventana el single-flight sigue mandando.
    act(() => {
      expect(beginRayenFill(9, t0 + RAYEN_FILL_STALE_AFTER_MS - 1)).toBe(false);
    });
    expect(result.current.running).toBe(true);

    // Pasado el techo, el candado se libera: el run viejo queda 'partial' con
    // error y un intento nuevo puede partir sin recargar la página.
    act(() => {
      expect(beginRayenFill(9, t0 + RAYEN_FILL_STALE_AFTER_MS + 1)).toBe(true);
    });
    expect(result.current).toMatchObject({ running: true, outcome: 'running' });

    act(() => {
      endRayenFill(0, false, getRayenFillAttemptId());
      expect(resetRayenFillProgress()).toBe(true);
    });
  });

  it('resetRayenFillProgress también libera una corrida vencida', () => {
    renderHook(() => useRayenFillProgress());
    const t0 = 2_000_000;

    act(() => {
      expect(beginRayenFill(3, t0)).toBe(true);
      expect(resetRayenFillProgress(t0 + 1_000)).toBe(false);
      expect(resetRayenFillProgress(t0 + RAYEN_FILL_STALE_AFTER_MS + 1)).toBe(true);
    });
  });

  it('keeps staffing persistence inside the synchronization single-flight boundary', () => {
    const { result } = renderHook(() => useRayenFillProgress());

    act(() => {
      expect(beginRayenFill(1)).toBe(true);
      endRayenFill(0, false, getRayenFillAttemptId());
      reportRayenStaffingOutcome('applying');
    });
    expect(resetRayenFillProgress()).toBe(false);
    expect(result.current.staffingOutcome).toBe('applying');

    act(() => {
      reportRayenStaffingOutcome('resolved');
      expect(resetRayenFillProgress()).toBe(true);
    });
  });

  it('ignores a stale worker while preserving the new worker and its abort handler', () => {
    const t0 = 3_000_000;
    expect(beginRayenFill(14, t0)).toBe(true);
    const oldAttempt = getRayenFillAttemptId();
    const oldAbort = vi.fn();
    registerRayenFillAbort(oldAbort, oldAttempt);
    expect(beginRayenFill(13, t0 + RAYEN_FILL_STALE_AFTER_MS + 1)).toBe(true);
    const newAttempt = getRayenFillAttemptId();
    const newAbort = vi.fn();
    registerRayenFillAbort(newAbort, newAttempt);
    reportRayenFillProgress(2, 13, newAttempt);
    const beforeLateCallbacks = getRayenFillProgressSnapshot();

    reportRayenFillProgress(14, 14, oldAttempt);
    registerRayenFillAbort(null, oldAttempt);
    endRayenFill(0, false, oldAttempt);
    expect(getRayenFillProgressSnapshot()).toBe(beforeLateCallbacks);
    expect(oldAbort).toHaveBeenCalledOnce();
    expect(newAbort).not.toHaveBeenCalled();
    expect(beginRayenFill(1, t0 + RAYEN_FILL_STALE_AFTER_MS + 2)).toBe(false);

    expect(resetRayenFillProgress(t0 + 2 * RAYEN_FILL_STALE_AFTER_MS + 2)).toBe(true);
    expect(newAbort).toHaveBeenCalledOnce();
  });

  it('does not revive cleared progress when an expired worker finally completes', () => {
    const t0 = 5_000_000;
    expect(beginRayenFill(14, t0)).toBe(true);
    const oldAttempt = getRayenFillAttemptId();
    expect(resetRayenFillProgress(t0 + RAYEN_FILL_STALE_AFTER_MS + 1)).toBe(true);
    const idle = getRayenFillProgressSnapshot();
    reportRayenFillProgress(14, 14, oldAttempt);
    endRayenFill(0, false, oldAttempt);
    expect(getRayenFillProgressSnapshot()).toBe(idle);
  });
});
