import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDeferredCensusModeUpdate } from '@/components/layout/navbar/useDeferredCensusModeUpdate';

describe('useDeferredCensusModeUpdate', () => {
  it('schedules mode update asynchronously', () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const { result } = renderHook(() =>
      useDeferredCensusModeUpdate({
        onUpdate,
      })
    );

    act(() => {
      result.current.schedule('ANALYTICS');
    });

    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });

    expect(onUpdate).toHaveBeenCalledWith('ANALYTICS');
    vi.useRealTimers();
  });

  it('cancels previous pending update when scheduling a new one', () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    const { result } = renderHook(() =>
      useDeferredCensusModeUpdate({
        onUpdate,
      })
    );

    act(() => {
      result.current.schedule('REGISTER');
      result.current.schedule('ANALYTICS');
      vi.runAllTimers();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('ANALYTICS');
    vi.useRealTimers();
  });
});
