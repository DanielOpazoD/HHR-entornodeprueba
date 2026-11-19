import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { featureFlags } from '@/services/utils/featureFlags';

vi.mock('@/services/utils/featureFlags', () => ({
  featureFlags: {
    isEnabled: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when flag is disabled', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

    const { result } = renderHook(() => useFeatureFlag('SPECIALTY_RULES_MEMORY'));

    expect(result.current).toBe(false);
  });

  it('should return true when flag is enabled', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(true);

    const { result } = renderHook(() => useFeatureFlag('SPECIALTY_RULES_MEMORY'));

    expect(result.current).toBe(true);
  });

  it('should subscribe to flag changes on mount', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

    renderHook(() => useFeatureFlag('SPECIALTY_RULES_MEMORY'));

    expect(featureFlags.subscribe).toHaveBeenCalledWith(
      'SPECIALTY_RULES_MEMORY',
      expect.any(Function)
    );
  });

  it('should unsubscribe on unmount', () => {
    const unsubscribeMock = vi.fn();
    vi.mocked(featureFlags.subscribe).mockReturnValue(unsubscribeMock);
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

    const { unmount } = renderHook(() => useFeatureFlag('SPECIALTY_RULES_MEMORY'));

    unmount();

    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('should update when flag state changes via subscription', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);
    let subscribeCallback: (() => void) | undefined;

    vi.mocked(featureFlags.subscribe).mockImplementation((_flag, cb) => {
      subscribeCallback = cb as () => void;
      return vi.fn();
    });

    const { result } = renderHook(() => useFeatureFlag('SPECIALTY_RULES_MEMORY'));

    expect(result.current).toBe(false);

    act(() => {
      vi.mocked(featureFlags.isEnabled).mockReturnValue(true);
      subscribeCallback?.();
    });

    expect(result.current).toBe(true);
  });
});
