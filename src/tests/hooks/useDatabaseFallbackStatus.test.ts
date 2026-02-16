import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/services/storage/indexedDBService', () => ({
  isDatabaseInFallbackMode: vi.fn(),
}));

import { isDatabaseInFallbackMode } from '@/services/storage/indexedDBService';
import { useDatabaseFallbackStatus } from '@/hooks/useDatabaseFallbackStatus';

describe('useDatabaseFallbackStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
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
});
