import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFeatureFlag, useAllFeatureFlags } from '@/hooks/useFeatureFlag';
import { featureFlags, FeatureFlag } from '@/services/utils/featureFlags';

vi.mock('@/services/utils/featureFlags', () => ({
  featureFlags: {
    isEnabled: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeAll: vi.fn(() => vi.fn()),
    getAll: vi.fn(() => ({})),
  },
}));

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when flag is disabled', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

    const { result } = renderHook(() => useFeatureFlag('SHOW_DEBUG_PANEL'));

    expect(result.current).toBe(false);
  });

  it('should return true when flag is enabled', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(true);

    const { result } = renderHook(() => useFeatureFlag('SHOW_DEBUG_PANEL'));

    expect(result.current).toBe(true);
  });

  it('should subscribe to flag changes on mount', () => {
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

    renderHook(() => useFeatureFlag('SHOW_DEBUG_PANEL'));

    expect(featureFlags.subscribe).toHaveBeenCalledWith('SHOW_DEBUG_PANEL', expect.any(Function));
  });

  it('should unsubscribe on unmount', () => {
    const unsubscribeMock = vi.fn();
    vi.mocked(featureFlags.subscribe).mockReturnValue(unsubscribeMock);
    vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

    const { unmount } = renderHook(() => useFeatureFlag('SHOW_DEBUG_PANEL'));

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

    const { result } = renderHook(() => useFeatureFlag('SHOW_DEBUG_PANEL'));

    expect(result.current).toBe(false);

    act(() => {
      vi.mocked(featureFlags.isEnabled).mockReturnValue(true);
      subscribeCallback?.();
    });

    expect(result.current).toBe(true);
  });
});

describe('useAllFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all flags', () => {
    const flagsSnapshot: Record<FeatureFlag, boolean> = {
      SHOW_DEBUG_PANEL: true,
      ENABLE_ANALYTICS_VIEW: true,
      SHOW_CUDYR_PRINT: true,
      ENABLE_OPTIMISTIC_UPDATES: true,
      ENABLE_OFFLINE_MODE: false,
      USE_ADMIT_PATIENT_COMMAND: true,
      USE_DISCHARGE_PATIENT_COMMAND: false,
      USE_TRANSFER_PATIENT_COMMAND: false,
      ENABLE_WHATSAPP_INTEGRATION: false,
      ENABLE_EMAIL_NOTIFICATIONS: true,
      VERBOSE_LOGGING: false,
      SHOW_PERFORMANCE_METRICS: false,
    };

    vi.mocked(featureFlags.getAll).mockReturnValue(flagsSnapshot);

    const { result } = renderHook(() => useAllFeatureFlags());

    expect(result.current).toEqual(flagsSnapshot);
    expect(featureFlags.subscribeAll).toHaveBeenCalledWith(expect.any(Function));
  });
});
