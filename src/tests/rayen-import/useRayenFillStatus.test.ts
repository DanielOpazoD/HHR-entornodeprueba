import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  beginRayenFill,
  endRayenFill,
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
      reportRayenFillProgress(2, 4);
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

    act(() => endRayenFill(0));
    expect(result.current).toMatchObject({
      running: false,
      outcome: 'rejected',
      attemptId: 2,
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
});
