import { useEffect, useRef, useState } from 'react';
import { defaultAuditPort } from '@/application/ports/auditPort';
import { startSessionActivityMonitor } from '@/services/auth/sessionActivityMonitor';
import { markRecentManualLogout } from '@/services/auth/authLogoutState';
import {
  clearPersistedFirebaseAuthState,
  clearRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import { createUnauthenticatedAuthSessionState } from '@/services/auth/authSessionState';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import { safeJsonParse } from '@/utils/jsonUtils';
import { authStateLogger } from '@/hooks/hookLoggers';
import { clearSessionScopedClientState } from '@/services/storage/sessionScopedStorageService';
import { clearQueryCache } from '@/config/queryClient';
import { broadcastLogout } from '@/services/auth/authBroadcastChannel';
import { clearCachedUserAvatarProfiles } from '@/services/user-profile/userAvatarProfileCache';

export const getE2EBootstrapUser = (): AuthUser | null => {
  if (typeof window === 'undefined' || !window.__HHR_E2E_OVERRIDE__) {
    return null;
  }

  const storedUser = localStorage.getItem('hhr_e2e_bootstrap_user');
  return safeJsonParse<AuthUser | null>(storedUser, null);
};

export const useOnlineStatus = (): boolean => {
  const [isOnline, setIsOnline] = useState(window.navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};

export const useFirebaseConnectionStatus = (
  user: AuthUser | null,
  isOnline: boolean,
  hasActiveFirebaseSession: () => boolean
): boolean => {
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  useEffect(() => {
    const checkConnection = () => {
      const hasSession = hasActiveFirebaseSession();
      setIsFirebaseConnected(isOnline && (hasSession || !!user));
    };

    checkConnection();
    const interval = setInterval(checkConnection, 1000);
    const timeout = setTimeout(() => clearInterval(interval), 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [user, isOnline, hasActiveFirebaseSession]);

  return isFirebaseConnected;
};

export const resetLocationToLoginRoute = (): void => {
  // The login screen must live on the root route: a refresh from a module URL
  // (e.g. /census) boots with the module preboot surface and flashes it before
  // the login page renders. Normalizing on logout keeps F5 on the login shell.
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  if (pathname === '/' && !search && !hash) return;
  try {
    window.history.replaceState(window.history.state, '', '/');
  } catch {
    // Best-effort: never let URL cleanup break the logout itself.
  }
};

/** Loading the audit module plus its own 1.5 s delivery budget. */
const LOGOUT_AUDIT_BUDGET_MS = 2_000;

const settleWithin = (task: Promise<unknown>, budgetMs: number): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, budgetMs);
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    task.then(settle, settle);
  });

export const createHandleLogout =
  (
    user: AuthUser | null,
    signOut: () => Promise<void>,
    setSessionState: (sessionState: AuthSessionState) => void
  ): ((reason?: 'manual' | 'automatic') => Promise<void>) =>
  async (reason: 'manual' | 'automatic' = 'manual') => {
    // 1. Synchronous operations first — cannot be interrupted by navigation or tab close
    setSessionState(createUnauthenticatedAuthSessionState());
    resetLocationToLoginRoute();
    clearQueryCache();
    clearCachedUserAvatarProfiles();

    clearRecentAuthenticatedSessionHint();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('hhr_e2e_bootstrap_user');
      }
    } catch {
      // Test-only hint cleanup must never interrupt a real logout.
    }
    if (reason === 'manual') {
      markRecentManualLogout();
    }

    // Notify other tabs so they can perform their own cleanup
    broadcastLogout(reason);

    // 2. Close the audit connection while still signed in: Firestore authenticates a write when
    //    it is sent, so an end event racing sign-out could be rejected. The whole step, loading
    //    the audit module included, is bounded: sign-out never waits on it. Anything undelivered
    //    stays queued on the device for the next sign-in.
    if (user?.email) {
      await settleWithin(
        defaultAuditPort
          .logUserLogout(user.email, reason)
          .catch(error => authStateLogger.warn('Logout audit step rejected', error)),
        LOGOUT_AUDIT_BUDGET_MS
      );
    }

    // 3. Async cleanup — best-effort, one failure does not block others
    const results = await Promise.allSettled([
      clearSessionScopedClientState(reason, async () => {
        try {
          await signOut();
        } finally {
          clearPersistedFirebaseAuthState();
        }
      }),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        authStateLogger.warn('Logout async step rejected', result.reason);
      }
    }
  };

export const useInactivityLogout = (
  user: AuthUser | null,
  handleLogout: (reason?: 'manual' | 'automatic') => Promise<void>
): void => {
  const userId = user?.uid;
  const logoutRef = useRef(handleLogout);
  useEffect(() => {
    logoutRef.current = handleLogout;
  }, [handleLogout]);
  useEffect(() => {
    if (!userId) return;
    return startSessionActivityMonitor(userId, () => {
      authStateLogger.warn('Logout due to inactivity');
      void logoutRef.current('automatic');
    });
  }, [userId]);
};
