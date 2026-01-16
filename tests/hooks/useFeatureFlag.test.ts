/**
 * useFeatureFlag Hook Tests
 * Tests for feature flag state management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFeatureFlag, useAllFeatureFlags } from '@/hooks/useFeatureFlag';
import { featureFlags } from '@/services';

// Mock the featureFlags service
vi.mock('@/services', () => ({
    featureFlags: {
        isEnabled: vi.fn(),
        subscribe: vi.fn(() => vi.fn()), // returns unsubscribe function
        getAll: vi.fn(() => ({}))
    }
}));

describe('useFeatureFlag', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Initial State', () => {
        it('should return false when flag is disabled', () => {
            vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

            const { result } = renderHook(() =>
                useFeatureFlag('SHOW_DEBUG_PANEL' as any)
            );

            expect(result.current).toBe(false);
        });

        it('should return true when flag is enabled', () => {
            vi.mocked(featureFlags.isEnabled).mockReturnValue(true);

            const { result } = renderHook(() =>
                useFeatureFlag('SHOW_DEBUG_PANEL' as any)
            );

            expect(result.current).toBe(true);
        });
    });

    describe('Subscription', () => {
        it('should subscribe to flag changes on mount', () => {
            vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

            renderHook(() => useFeatureFlag('SHOW_DEBUG_PANEL' as any));

            expect(featureFlags.subscribe).toHaveBeenCalledWith(
                'SHOW_DEBUG_PANEL',
                expect.any(Function)
            );
        });

        it('should unsubscribe on unmount', () => {
            const unsubscribeMock = vi.fn();
            vi.mocked(featureFlags.subscribe).mockReturnValue(unsubscribeMock);
            vi.mocked(featureFlags.isEnabled).mockReturnValue(false);

            const { unmount } = renderHook(() =>
                useFeatureFlag('SHOW_DEBUG_PANEL' as any)
            );

            unmount();

            expect(unsubscribeMock).toHaveBeenCalled();
        });
    });

    describe('Re-render on flag change', () => {
        it('should update when flag state changes via subscription', () => {
            vi.mocked(featureFlags.isEnabled).mockReturnValue(false);
            let subscribeCallback: (value: boolean) => void = () => { };
            vi.mocked(featureFlags.subscribe).mockImplementation((flag, cb) => {
                subscribeCallback = cb;
                return vi.fn();
            });

            const { result } = renderHook(() =>
                useFeatureFlag('SHOW_DEBUG_PANEL' as any)
            );

            expect(result.current).toBe(false);

            // Simulate flag change
            act(() => {
                subscribeCallback(true);
            });

            expect(result.current).toBe(true);
        });
    });
});

describe('useAllFeatureFlags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return all flags', () => {
        vi.mocked(featureFlags.getAll).mockReturnValue({
            'SHOW_DEBUG_PANEL': true,
            'ENABLE_WHATSAPP': false
        } as any);

        const { result } = renderHook(() => useAllFeatureFlags());

        expect(result.current).toEqual({
            'SHOW_DEBUG_PANEL': true,
            'ENABLE_WHATSAPP': false
        });
    });
});
