/**
 * Staleness guard: invalidates daily record queries when a tab returns
 * from background to foreground.
 *
 * When a tab is inactive (minimized, behind other tabs, or on a different
 * window), its Firestore real-time listener may be paused by the browser.
 * During that time, other users on other PCs may update the same record.
 * Without this guard, the stale local data could be saved back to Firestore,
 * overwriting the newer changes.
 *
 * This hook triggers broad refetch work when the user returns to the tab.
 * The clinical edit safety gate lives in the daily record query/mutation flow,
 * where mutations wait for Firebase confirmation after longer inactivity.
 */

import { useEffect, useRef } from 'react';
import { queryClient, queryKeys } from '@/config/queryClient';

/** Minimum time the tab must be hidden before triggering a refetch (ms). */
const MIN_HIDDEN_DURATION_MS = 30_000;

export const useStalenessGuard = (): void => {
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }

      // Tab became visible again
      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;

      if (!hiddenSince) return;

      const hiddenDuration = Date.now() - hiddenSince;
      if (hiddenDuration < MIN_HIDDEN_DURATION_MS) return;

      // Tab was hidden for a meaningful period — refetch daily record data
      queryClient.invalidateQueries({ queryKey: queryKeys.dailyRecord.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
};
