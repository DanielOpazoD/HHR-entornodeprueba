import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { useEffect } from 'react';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import {
  clearAuthBootstrapPending,
  getAuthBootstrapPendingAgeMs,
  isAuthBootstrapPending,
} from '@/services/auth/authBootstrapState';
import { hasRecentManualLogout } from '@/services/auth/authLogoutState';
import {
  createAuthErrorSessionState,
  toResolvedAuthSessionState,
} from '@/services/auth/authSessionState';
import { authStateLogger } from '@/hooks/hookLoggers';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { resolveAuthBootstrapBudget } from '@/services/auth/authBootstrapBudgets';
import { hasActiveFirebaseSession } from '@/services/auth/authFallback';
import {
  hasPersistedFirebaseAuthHint,
  hasRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import { markPerf } from '@/shared/runtime/perfAudit';
import {
  buildBootstrapTimeoutAuthError,
  buildBootstrapTimeoutIssue,
  shouldAttemptAuthTimeoutRecovery,
  shouldResolveAuthBootstrapImmediatelyAsUnauthenticated,
} from '@/hooks/controllers/authBootstrapController';
import { applyResolvedBootstrapSessionState } from '@/hooks/controllers/authResolvedBootstrapSessionController';
import { subscribeToResolvedAuthState } from '@/hooks/controllers/authResolvedStateSubscription';

export { subscribeToResolvedAuthState };
export {
  createHandleLogout,
  getAuthBootstrapTimeoutMs,
  getE2EBootstrapUser,
  resetLocationToLoginRoute,
  useFirebaseConnectionStatus,
  useInactivityLogout,
  useOnlineStatus,
} from '@/hooks/useAuthStateSessionSupport';

export const useResolvedAuthBootstrap = ({
  e2eBootstrapUser,
  resolveRedirectAuthSessionOutcome,
  resolveCurrentAuthSessionOutcome,
  onAuthSessionStateChange,
  setSessionState,
  setAuthLoading,
}: {
  e2eBootstrapUser: AuthUser | null;
  resolveRedirectAuthSessionOutcome: () => Promise<ApplicationOutcome<AuthSessionState | null>>;
  resolveCurrentAuthSessionOutcome: () => Promise<ApplicationOutcome<AuthSessionState | null>>;
  onAuthSessionStateChange: (
    callback: (sessionState: AuthSessionState) => void | Promise<void>
  ) => () => void;
  setSessionState: (sessionState: AuthSessionState) => void;
  setAuthLoading: (value: boolean) => void;
}): void => {
  useEffect(() => {
    markPerf('auth-bootstrap:effect-start');
    if (e2eBootstrapUser) {
      setSessionState(toResolvedAuthSessionState(e2eBootstrapUser));
      setAuthLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let active = true;
    const applySessionState = (next: AuthSessionState) => {
      if (active) setSessionState(next);
    };
    const hasPendingRedirect = isAuthBootstrapPending();
    const hasAuthRehydrationHint =
      hasPersistedFirebaseAuthHint() || hasRecentAuthenticatedSessionHint();
    const canResolveImmediatelyAsUnauthenticatedAfterDirectChecks =
      shouldResolveAuthBootstrapImmediatelyAsUnauthenticated({
        hasPendingRedirect,
        hasAuthRehydrationHint,
        hasActiveFirebaseSession: hasActiveFirebaseSession(),
      });

    const bootstrapBudget = resolveAuthBootstrapBudget({
      hasRecentManualLogout: hasRecentManualLogout(),
      isOnline: window.navigator.onLine,
      hasPendingRedirect,
    });
    const timeoutMs = bootstrapBudget.timeoutMs;
    let isBootstrapResolved = false;
    const safetyTimeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (isBootstrapResolved) {
        return;
      }

      authStateLogger.info(
        `Auth initialization timed out (${timeoutMs}ms) - forcing load completion`,
        {
          isOnline: window.navigator.onLine,
          authBootstrapPending: isAuthBootstrapPending(),
        }
      );
      recordOperationalTelemetry({
        category: 'auth',
        operation: 'bootstrap_timeout',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: {
          timeoutMs,
          budgetProfile: bootstrapBudget.profile,
          pendingAgeMs: getAuthBootstrapPendingAgeMs(),
          isOnline: window.navigator.onLine,
          authBootstrapPending: isAuthBootstrapPending(),
        },
        issues: [buildBootstrapTimeoutIssue()],
      });

      if (
        shouldAttemptAuthTimeoutRecovery({
          hasRecentManualLogout: hasRecentManualLogout(),
          hasAuthRehydrationHint,
        })
      ) {
        void resolveCurrentAuthSessionOutcome()
          .then(timeoutRecoveryOutcome => {
            recordOperationalOutcome(
              'auth',
              'timeout_current_session_resolution',
              timeoutRecoveryOutcome,
              {
                allowSuccess: true,
              }
            );

            if (isBootstrapResolved) {
              return;
            }

            if (timeoutRecoveryOutcome.status === 'success' && timeoutRecoveryOutcome.data) {
              applyResolvedBootstrapSessionState({
                sessionState: timeoutRecoveryOutcome.data,
                setSessionState: applySessionState,
                setAuthLoading: setResolvedAuthLoading,
              });
              return;
            }

            clearAuthBootstrapPending();
            setSessionState(createAuthErrorSessionState(buildBootstrapTimeoutAuthError()));
            setResolvedAuthLoading(false);
          })
          .catch(error => {
            if (isBootstrapResolved) {
              return;
            }

            authStateLogger.warn('Auth timeout recovery resolution failed', error);
            clearAuthBootstrapPending();
            setSessionState(createAuthErrorSessionState(buildBootstrapTimeoutAuthError()));
            setResolvedAuthLoading(false);
          });
        return;
      }

      clearAuthBootstrapPending();
      setSessionState(createAuthErrorSessionState(buildBootstrapTimeoutAuthError()));
      setResolvedAuthLoading(false);
    }, timeoutMs);

    const markBootstrapResolved = () => {
      if (isBootstrapResolved) {
        return;
      }

      isBootstrapResolved = true;
      clearTimeout(safetyTimeout);
    };
    const setResolvedAuthLoading = (value: boolean) => {
      if (!active) return;
      if (!value) {
        markPerf('auth-bootstrap:loading-false');
        markBootstrapResolved();
      }
      setAuthLoading(value);
    };

    subscribeToResolvedAuthState({
      resolveRedirectAuthSessionOutcome,
      resolveCurrentAuthSessionOutcome,
      onAuthSessionStateChange,
      resolveImmediatelyAsUnauthenticatedWhenDirectChecksAreEmpty:
        canResolveImmediatelyAsUnauthenticatedAfterDirectChecks,
      hasAuthRehydrationHint,
      setSessionState: applySessionState,
      setAuthLoading: setResolvedAuthLoading,
      isActive: () => active,
    }).then(unsub => {
      if (active) unsubscribe = unsub;
      else unsub();
    });

    return () => {
      active = false;
      markBootstrapResolved();
      if (unsubscribe) unsubscribe();
    };
  }, [
    e2eBootstrapUser,
    resolveRedirectAuthSessionOutcome,
    resolveCurrentAuthSessionOutcome,
    onAuthSessionStateChange,
    setAuthLoading,
    setSessionState,
  ]);
};
