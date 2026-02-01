/**
 * useFeatureFlag Hook
 * React hook for checking feature flag state with automatic re-renders.
 */

import { useSyncExternalStore } from 'react';
import { featureFlags, FeatureFlag } from '@/services';

/**
 * Hook to check if a feature flag is enabled.
 * Automatically re-renders when the flag state changes.
 * 
 * @example
 * const showDebug = useFeatureFlag('SHOW_DEBUG_PANEL');
 * if (showDebug) { ... }
 */
export const useFeatureFlag = (flag: FeatureFlag): boolean => {
    return useSyncExternalStore(
        (callback) => featureFlags.subscribe(flag, callback),
        () => featureFlags.isEnabled(flag)
    );
};

/**
 * Hook to get all feature flags with their current values.
 * Useful for admin/debug panels.
 * Automatically re-renders when any flag state changes.
 */
export const useAllFeatureFlags = (): Record<FeatureFlag, boolean> => {
    return useSyncExternalStore(
        (callback) => featureFlags.subscribeAll(callback),
        () => featureFlags.getAll()
    );
};
