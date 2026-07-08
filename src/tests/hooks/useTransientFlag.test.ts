import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTransientFlag } from '@/hooks/useTransientFlag';

describe('useTransientFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flashes a value and auto-reverts to the base after the delay', () => {
    const { result } = renderHook(() => useTransientFlag<string | null>(null, 1800));

    act(() => result.current[1]('exam-1'));
    expect(result.current[0]).toBe('exam-1');

    act(() => vi.advanceTimersByTime(1800));
    expect(result.current[0]).toBeNull();
  });

  it('does not revert when the value changed again before the delay (latest flash wins)', () => {
    const { result } = renderHook(() => useTransientFlag<string | null>(null, 1800));

    act(() => result.current[1]('exam-1'));
    act(() => vi.advanceTimersByTime(900));
    act(() => result.current[1]('exam-2'));

    // The first revert must not clear the newer value.
    act(() => vi.advanceTimersByTime(900));
    expect(result.current[0]).toBe('exam-2');

    act(() => vi.advanceTimersByTime(900));
    expect(result.current[0]).toBeNull();
  });

  it('keeps a sticky setValue and never auto-reverts it', () => {
    const { result } = renderHook(() =>
      useTransientFlag<'idle' | 'copied' | 'failed'>('idle', 1800)
    );

    act(() => result.current[1]('copied'));
    act(() => result.current[2]('failed'));

    // The pending revert from the flash sees 'failed', not 'copied', so it no-ops.
    act(() => vi.advanceTimersByTime(1800));
    expect(result.current[0]).toBe('failed');
  });

  it('clears the pending revert on unmount', () => {
    const { result, unmount } = renderHook(() => useTransientFlag<string | null>(null, 1800));

    act(() => result.current[1]('exam-1'));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
