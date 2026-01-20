/**
 * useFeatureFlag Hook
 * React hook for checking feature flag state with automatic re-renders.
 */

import { useSyncExternalStore, useState, useEffect, useCallback } from 'react';
import { featureFlags, FeatureFlag } from '../services';

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
 */
export const useAllFeatureFlags = (): Record<FeatureFlag, boolean> => {
    const [flags, setFlags] = useState(() => featureFlags.getAll());

    const updateFlags = useCallback(() => {
        setFlags(featureFlags.getAll());
    }, []);

    useEffect(() => {
        // Simple approach: poll on interval for debug purposes
        const interval = setInterval(updateFlags, 1000);
        return () => clearInterval(interval);
    }, [updateFlags]);

    return flags;
};
