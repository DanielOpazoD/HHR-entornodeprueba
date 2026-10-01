/**
 * Pure (non-hook) subscription helper for the resolved auth bootstrap flow,
 * extracted out of useAuthStateSupport to keep the hook under the module-size
 * guardrail and to give the subscription an isolated, directly-testable
 * surface. The hook (useResolvedAuthBootstrap) now wires the safety timeout
 * and the lifecycle, but delegates the redirect / current-session / observer
 * coordination to this module.
 *
 * The function does three things, in order:
 *   1. Resolves any pending OAuth redirect outcome (post-popup or post-redirect).
 *   2. If no redirect outcome, resolves the current session synchronously.
 *   3. Subscribes to onAuthSessionStateChange and decides per event whether
 *      to apply, ignore (transient flap during persistence rehydration),
 *      treat as manual logout, escalate as Google attempt timeout, or defer.
 *
 * Returns the unsubscribe function the caller must invoke on unmount.
 */
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import type { AuthSessionState } from '@/types/authSessionTypes';
import {
  clearAuthBootstrapPending,
  getAuthBootstrapPendingAgeMs,
  isAuthBootstrapPending,
} from '@/services/auth/authBootstrapState';
import { clearRecentManualLogout, hasRecentManualLogout } from '@/services/auth/authLogoutState';
import {
  createAuthErrorSessionState,
  createUnauthenticatedAuthSessionState,
  isAuthenticatedAuthSessionState,
} from '@/services/auth/authSessionState';
import { authStateLogger } from '@/hooks/hookLoggers';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { hasActiveFirebaseSession } from '@/services/auth/authFallback';
import {
  clearGoogleLoginAttemptHint,
  hasRecentGoogleLoginAttemptHint,
} from '@/services/auth/authStorageHints';
import { markPerf } from '@/shared/runtime/perfAudit';
import {
  buildBootstrapTimeoutAuthError,
  shouldDeferUnauthenticatedSessionState,
  shouldIgnoreTransientUnauthenticatedBootstrapEvent,
} from '@/hooks/controllers/authBootstrapController';
import { applyResolvedBootstrapSessionState } from '@/hooks/controllers/authResolvedBootstrapSessionController';

export interface SubscribeToResolvedAuthStateInput {
  isActive?: () => boolean;
  resolveRedirectAuthSessionOutcome: () => Promise<ApplicationOutcome<AuthSessionState | null>>;
  resolveCurrentAuthSessionOutcome: () => Promise<ApplicationOutcome<AuthSessionState | null>>;
  onAuthSessionStateChange: (
    callback: (sessionState: AuthSessionState) => void | Promise<void>
  ) => () => void;
  resolveImmediatelyAsUnauthenticatedWhenDirectChecksAreEmpty: boolean;
  hasAuthRehydrationHint: boolean;
  setSessionState: (sessionState: AuthSessionState) => void;
  setAuthLoading: (value: boolean) => void;
}

const resolveBootstrapDirectChecks = async ({
  resolveRedirectAuthSessionOutcome,
  resolveCurrentAuthSessionOutcome,
  resolveImmediatelyAsUnauthenticatedWhenDirectChecksAreEmpty,
  hasAuthRehydrationHint,
  setSessionState,
  setAuthLoading,
  isActive,
}: Pick<
  SubscribeToResolvedAuthStateInput,
  | 'resolveRedirectAuthSessionOutcome'
  | 'resolveCurrentAuthSessionOutcome'
  | 'resolveImmediatelyAsUnauthenticatedWhenDirectChecksAreEmpty'
  | 'hasAuthRehydrationHint'
  | 'setSessionState'
  | 'setAuthLoading'
  | 'isActive'
>): Promise<{ resolved: boolean; sessionState?: AuthSessionState }> => {
  try {
    markPerf('auth-bootstrap:redirect-start');
    const redirectOutcome = await resolveRedirectAuthSessionOutcome();
    if (isActive?.() === false) return { resolved: false };
    markPerf('auth-bootstrap:redirect-done', redirectOutcome.status);
    recordOperationalOutcome('auth', 'redirect_resolution', redirectOutcome, {
      allowSuccess: true,
    });
    const redirectSessionState = redirectOutcome.data;
    if (redirectSessionState) {
      applyResolvedBootstrapSessionState({
        sessionState: redirectSessionState,
        setSessionState,
        setAuthLoading,
      });
      return { resolved: true, sessionState: redirectSessionState };
    }

    markPerf('auth-bootstrap:current-session-start');
    const currentSessionOutcome = await resolveCurrentAuthSessionOutcome();
    if (isActive?.() === false) return { resolved: false };
    markPerf('auth-bootstrap:current-session-done', currentSessionOutcome.status);
    recordOperationalOutcome('auth', 'current_session_resolution', currentSessionOutcome, {
      allowSuccess: true,
    });
    if (currentSessionOutcome.data) {
      applyResolvedBootstrapSessionState({
        sessionState: currentSessionOutcome.data,
        setSessionState,
        setAuthLoading,
      });
      return { resolved: true, sessionState: currentSessionOutcome.data };
    }

    if (
      !hasAuthRehydrationHint &&
      (resolveImmediatelyAsUnauthenticatedWhenDirectChecksAreEmpty ||
        (!isAuthBootstrapPending() && !hasActiveFirebaseSession()))
    ) {
      clearAuthBootstrapPending();
      setSessionState(createUnauthenticatedAuthSessionState());
      setAuthLoading(false);
      return { resolved: true };
    }
  } catch (error) {
    authStateLogger.info('Redirect result check error', error);
    recordOperationalTelemetry({
      category: 'auth',
      operation: 'redirect_resolution_failure',
      status: 'degraded',
      runtimeState: 'recoverable',
      context: {
        isOnline: window.navigator.onLine,
        authBootstrapPending: isAuthBootstrapPending(),
        pendingAgeMs: getAuthBootstrapPendingAgeMs(),
      },
      issues: [error instanceof Error ? error.message : 'No se pudo revisar el redirect de auth.'],
    });
  }

  return { resolved: false };
};

const handleSessionStateChange = ({
  sessionState,
  isBootstrapLoading,
  hasAuthRehydrationHint,
  setSessionState,
  setAuthLoading,
}: {
  sessionState: AuthSessionState;
  isBootstrapLoading: boolean;
  hasAuthRehydrationHint: boolean;
  setSessionState: (next: AuthSessionState) => void;
  setAuthLoading: (value: boolean) => void;
}): { handled: boolean; isBootstrapLoading: boolean } => {
  if (isAuthenticatedAuthSessionState(sessionState)) {
    applyResolvedBootstrapSessionState({
      sessionState,
      setSessionState,
      setAuthLoading,
    });
    return { handled: true, isBootstrapLoading: false };
  }

  if (
    shouldIgnoreTransientUnauthenticatedBootstrapEvent({
      isBootstrapLoading,
      sessionState,
      hasRecentManualLogout: hasRecentManualLogout(),
      hasAuthRehydrationHint,
    })
  ) {
    authStateLogger.info(
      'Ignoring transient unauthenticated auth event while persistence rehydrates'
    );
    return { handled: true, isBootstrapLoading };
  }

  if (hasRecentManualLogout()) {
    clearRecentManualLogout();
    clearAuthBootstrapPending();
    setSessionState(createUnauthenticatedAuthSessionState());
    setAuthLoading(false);
    return { handled: true, isBootstrapLoading: false };
  }

  if (
    sessionState.status === 'unauthenticated' &&
    hasRecentGoogleLoginAttemptHint() &&
    !hasRecentManualLogout()
  ) {
    clearGoogleLoginAttemptHint();
    clearAuthBootstrapPending();
    setSessionState(createAuthErrorSessionState(buildBootstrapTimeoutAuthError()));
    setAuthLoading(false);
    return { handled: true, isBootstrapLoading: false };
  }

  if (
    shouldDeferUnauthenticatedSessionState({
      sessionState,
      isAuthBootstrapPending: isAuthBootstrapPending(),
    })
  ) {
    return { handled: true, isBootstrapLoading };
  }

  setSessionState(sessionState);
  return { handled: false, isBootstrapLoading };
};

const isSameAuthorizedUser = (first: AuthUser, next: AuthUser): boolean =>
  first.uid === next.uid &&
  first.email === next.email &&
  first.displayName === next.displayName &&
  first.photoURL === next.photoURL &&
  first.role === next.role &&
  (first.medicalSpecialties?.length ?? 0) === (next.medicalSpecialties?.length ?? 0) &&
  (first.medicalSpecialties ?? []).every(
    (specialty, index) => specialty === next.medicalSpecialties?.[index]
  );

export const subscribeToResolvedAuthState = async (
  input: SubscribeToResolvedAuthStateInput
): Promise<() => void> => {
  let isBootstrapLoading = true;

  const directChecks = await resolveBootstrapDirectChecks(input);
  if (input.isActive?.() === false) return () => {};
  if (directChecks.resolved) {
    isBootstrapLoading = false;
  }

  // Firebase emits the restored session once when its observer subscribes.
  // Direct checks have already submitted it for owner admission; that original
  // admission must still complete before the shell becomes authorized.
  // Suppress only that first identical echo; later events and any changed
  // identity/permissions still go through admission and revocation normally.
  let isInitialObserverEvent = true;
  markPerf('auth-bootstrap:observer-subscribe');
  return input.onAuthSessionStateChange(async sessionState => {
    if (input.isActive?.() === false) return;
    const isInitialEcho =
      isInitialObserverEvent &&
      directChecks.sessionState?.status === 'authorized' &&
      sessionState.status === 'authorized' &&
      isSameAuthorizedUser(directChecks.sessionState.user, sessionState.user);
    isInitialObserverEvent = false;
    if (isInitialEcho) return;
    markPerf('auth-bootstrap:observer-event', sessionState.status);
    recordOperationalTelemetry(
      {
        category: 'auth',
        operation: 'session_state_change',
        status: sessionState.status === 'auth_error' ? 'failed' : 'success',
        context: {
          sessionStatus: sessionState.status,
        },
        issues:
          sessionState.status === 'auth_error' && sessionState.error.userSafeMessage
            ? [sessionState.error.userSafeMessage]
            : undefined,
      },
      { allowSuccess: true }
    );

    const result = handleSessionStateChange({
      sessionState,
      isBootstrapLoading,
      hasAuthRehydrationHint: input.hasAuthRehydrationHint,
      setSessionState: input.setSessionState,
      setAuthLoading: input.setAuthLoading,
    });
    isBootstrapLoading = result.isBootstrapLoading;
    if (result.handled) return;

    clearAuthBootstrapPending();
    input.setAuthLoading(false);
    isBootstrapLoading = false;
  });
};
