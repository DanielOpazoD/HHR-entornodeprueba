/**
 * useFeatureFlag Hook
 * React hook for checking feature flag state with automatic re-renders.
 */

import { useSyncExternalStore } from 'react';
import { featureFlags, type FeatureFlag } from '@/services/utils/featureFlags';

/**
 * Hook to check if a feature flag is enabled.
 * Automatically re-renders when the flag state changes.
 *
 * @example
 * const rulesMemory = useFeatureFlag('SPECIALTY_RULES_MEMORY');
 * if (rulesMemory) { ... }
 */
export const useFeatureFlag = (flag: FeatureFlag): boolean => {
  return useSyncExternalStore(
    callback => featureFlags.subscribe(flag, callback),
    () => featureFlags.isEnabled(flag)
  );
};
