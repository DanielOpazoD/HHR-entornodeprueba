import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useManagedTimeout } from '@/hooks/useManagedTimeout';

describe('useManagedTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the callback after the delay', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useManagedTimeout());

    act(() => result.current(callback, 1000));
    expect(callback).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1000));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('clears the pending timer on unmount (callback never fires)', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useManagedTimeout());

    act(() => result.current(callback, 1000));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    act(() => vi.advanceTimersByTime(2000));
    expect(callback).not.toHaveBeenCalled();
  });

  it('replaces the previous timer when scheduled again (only the latest fires)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() => useManagedTimeout());

    act(() => result.current(first, 1000));
    act(() => result.current(second, 1000));
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
