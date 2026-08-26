import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  isDatabaseInFallbackMode: vi.fn(),
}));

import { isDatabaseInFallbackMode } from '@/services/storage/indexeddb/indexedDbCore';
import { useDatabaseFallbackStatus } from '@/hooks/useDatabaseFallbackStatus';

describe('useDatabaseFallbackStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.__HHR_E2E_OVERRIDE__ = undefined;
  });

  afterEach(() => {
    window.__HHR_E2E_OVERRIDE__ = undefined;
    vi.useRealTimers();
  });

  it('returns current fallback state', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);

    const { result } = renderHook(() => useDatabaseFallbackStatus());

    expect(result.current).toBe(true);
  });

  it('updates value on poll interval', () => {
    let fallback = false;
    vi.mocked(isDatabaseInFallbackMode).mockImplementation(() => fallback);

    const { result } = renderHook(() => useDatabaseFallbackStatus({ pollIntervalMs: 1000 }));
    expect(result.current).toBe(false);

    act(() => {
      fallback = true;
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(true);
  });

  it('does not expose intentional E2E mock storage as degraded fallback', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    window.__HHR_E2E_OVERRIDE__ = {};

    const { result } = renderHook(() => useDatabaseFallbackStatus({ pollIntervalMs: 1000 }));

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(false);
    expect(isDatabaseInFallbackMode).toHaveBeenCalled();
  });

  it('exposes a real fallback after an E2E override is removed', () => {
    vi.mocked(isDatabaseInFallbackMode).mockReturnValue(true);
    window.__HHR_E2E_OVERRIDE__ = {};

    const { result } = renderHook(() => useDatabaseFallbackStatus({ pollIntervalMs: 1000 }));
    expect(result.current).toBe(false);

    act(() => {
      window.__HHR_E2E_OVERRIDE__ = undefined;
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(true);
  });

  it('does not start polling when disabled', () => {
    let fallback = false;
    vi.mocked(isDatabaseInFallbackMode).mockImplementation(() => fallback);

    const { result } = renderHook(() =>
      useDatabaseFallbackStatus({ enabled: false, pollIntervalMs: 1000 })
    );

    expect(result.current).toBe(false);

    act(() => {
      fallback = true;
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBe(false);
    expect(isDatabaseInFallbackMode).toHaveBeenCalledTimes(1);
  });

  it('pauses polling while the document is hidden and resumes on visibility change', () => {
    let fallback = false;
    vi.mocked(isDatabaseInFallbackMode).mockImplementation(() => fallback);

    const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const { result } = renderHook(() => useDatabaseFallbackStatus({ pollIntervalMs: 1000 }));
    expect(result.current).toBe(false);

    act(() => {
      fallback = true;
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(false);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toBe(true);

    if (visibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityStateDescriptor);
    }
  });
});
