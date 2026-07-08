import { useEffect } from 'react';
import { ensureUserRoleClaim } from '@/services/auth/authClaimSyncService';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import type { UserRole } from '@/types/authRoleTypes';

const DEFAULT_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface AuthClaimRefreshSchedulerOptions {
  enabled: boolean;
  role: UserRole | null;
  intervalMs?: number;
}

/**
 * Periodically reconciles the local resolved role with the Firebase ID token
 * claim while the session is active. If the two diverge, ensureUserRoleClaim
 * triggers a Cloud Function call and a forced token refresh, which is the
 * client-side mitigation for the gap between firestore.rules (reads
 * config/roles live, so revocation is instant) and storage.rules (reads the
 * cached custom claim, which would otherwise stay valid until the token
 * expires ~1h after the change).
 *
 * Two triggers cover most realistic clinical use:
 *  - setInterval at intervalMs (default 10 min) catches background changes
 *    while the dashboard stays open in the foreground.
 *  - visibilitychange fires the moment a previously hidden tab becomes
 *    visible again, so a user returning after lunch sees the refreshed
 *    state without having to wait the full polling window.
 *
 * The scheduler is a no-op when disabled or when there is no resolved role
 * (login page, signed-out state, anonymous signature mode).
 */
export const useAuthClaimRefreshScheduler = ({
  enabled,
  role,
  intervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: AuthClaimRefreshSchedulerOptions): void => {
  useEffect(() => {
    if (!enabled || !role) return;

    const refresh = () => {
      const firebaseUser = defaultAuthRuntime.getCurrentUser();
      if (!firebaseUser) return;
      void ensureUserRoleClaim(firebaseUser, role);
    };

    const timerId = window.setInterval(refresh, intervalMs);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refresh();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      window.clearInterval(timerId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, role, intervalMs]);
};
